// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindingsFrom, type Bindings } from '../input/keymap';
import { DEFAULT_SETTINGS } from '../settings';
import { confirmDialog } from './confirm';
import { pauseMenu } from './pause';
import { keymapRows } from './settings-keymap';

function deps() {
  return {
    objectives: () => [
      { text: 'Take the crossroads', primary: true, status: 'active' },
      { text: 'Lose no one', primary: false, status: 'active' },
    ],
    onResume: vi.fn(),
    onRestart: vi.fn(),
    onQuit: vi.fn(),
    settings: {
      get: () => DEFAULT_SETTINGS,
      set: vi.fn(),
      fullscreen: null,
      audio: null,
      locales: [{ id: 'en', name: 'English' }],
      keymap: null,
      build: '0.68.0',
      onChange: () => () => {},
    },
    build: '0.68.0',
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('pauseMenu', () => {
  it('is a modal that lists the objectives and takes focus', () => {
    const d = deps();
    pauseMenu(document.body, d);
    const dlg = document.querySelector('.rl-pause');
    expect(dlg?.getAttribute('role')).toBe('dialog');
    expect(dlg?.getAttribute('aria-modal')).toBe('true');
    expect(dlg?.textContent).toContain('Take the crossroads');
    expect(document.activeElement?.textContent).toBe('Resume');
  });
  it('Escape and Resume both resume; nothing else leaks to the game', () => {
    const d = deps();
    pauseMenu(document.body, d);
    const leaked = vi.fn();
    window.addEventListener('keydown', leaked);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    expect(leaked).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(d.onResume).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', leaked);
    expect(document.querySelector('.rl-pause')).toBeNull();
  });
  // Found driving the real app (Task 6's brief): "WASD still pans" while the
  // modal is up -- panning is presentation only (`renderer.camera.x/y`), so
  // the capture guard exempts the four default pan keys alongside Escape/
  // Enter/Tab, unlike a plain confirmDialog which has no reason to. A
  // non-pan game verb on the same physical row ('h', halt) must still be
  // swallowed, which the existing "nothing else leaks" test above already
  // covers for a letter outside this row.
  it('pan keys (WASD and the arrows) are not swallowed by the capture guard; a non-pan key still is', () => {
    const d = deps();
    pauseMenu(document.body, d);
    const seen: string[] = [];
    const gameVerbListener = (e: KeyboardEvent): void => {
      seen.push(e.key);
    };
    window.addEventListener('keydown', gameVerbListener);
    try {
      for (const key of ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
      expect(seen).toEqual(['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      expect(seen).toEqual(['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']); // 'h' did not reach it
    } finally {
      window.removeEventListener('keydown', gameVerbListener);
    }
  });
  it('the Settings tab mounts the settings table inside the modal, not a navigation', () => {
    const d = deps();
    pauseMenu(document.body, d);
    (document.querySelector('.rl-pause button[data-tab="settings"]') as HTMLButtonElement).click();
    expect(document.querySelector('.rl-pause .rl-settings')).not.toBeNull();
  });
  it('Restart and Quit hand off to the caller without closing (the caller confirms)', () => {
    const d = deps();
    pauseMenu(document.body, d);
    (document.querySelector('.rl-pause button[data-act="restart"]') as HTMLButtonElement).click();
    expect(d.onRestart).toHaveBeenCalledTimes(1);
    (document.querySelector('.rl-pause button[data-act="quit"]') as HTMLButtonElement).click();
    expect(d.onQuit).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.rl-pause')).not.toBeNull();
  });

  // Interaction (a): a confirmDialog opened from the pause menu's own Restart
  // or Quit button (`onRestart`/`onQuit` in main.ts's real wiring) sits ON TOP
  // of the pause modal in the DOM, and must both (1) keep swallowing every
  // game-verb key -- its own capture guard registers AFTER the pause menu's,
  // on the same `window` target, and both guards independently stopPropagation
  // a non-Escape/Enter/Tab key, so late registration is not a problem -- and
  // (2) resolve Escape as ITS OWN cancel, not the pause menu's Resume.
  //
  // (2) is the part a naive mirror of confirm.ts gets wrong: pause's own
  // bubble-phase Escape listener is registered FIRST (at pauseMenu mount) and
  // confirm's is registered SECOND (when the confirm opens); same-node,
  // same-phase listeners run in REGISTRATION order, so without a guard
  // pause's listener would fire before confirm's on every Escape and resume
  // the game out from under a dialog asking "are you sure". `pause.ts`'s own
  // Escape handler checks for a live `.rl-confirm` in the DOM before acting.
  it('a confirmDialog opened from the pause menu stacks above it: game keys are still swallowed, and Escape cancels the confirm, not the pause menu', async () => {
    const d = deps();
    pauseMenu(document.body, d);
    const seen: string[] = [];
    const gameVerbListener = (e: KeyboardEvent): void => {
      seen.push(e.key);
    };
    window.addEventListener('keydown', gameVerbListener);
    try {
      const p = confirmDialog(document.body, { title: 'Restart the mission?', body: 'b', confirm: 'Restart', danger: true });
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      expect(seen).toEqual([]);

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await expect(p).resolves.toBe(false);
      // The confirm is gone; the pause menu underneath is untouched.
      expect(document.querySelector('.rl-confirm')).toBeNull();
      expect(document.querySelector('.rl-pause')).not.toBeNull();
      expect(d.onResume).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', gameVerbListener);
    }
  });

  // Interaction (b): the settings panel (Task 4) is mounted INSIDE the pause
  // modal, and its Controls section (Task 5, settings-keymap.ts) can arm a
  // capture-phase "press a key…" listener that registers LATER than the pause
  // modal's own capture guard and calls stopImmediatePropagation. A captured
  // key must reach neither the game (nothing bubbles) nor resume the pause
  // menu, and Escape while a capture is pending must only cancel the capture,
  // not close the menu.
  it('a pending keymap capture inside the mounted settings panel wins over the pause modal: a captured key neither reaches the game nor resumes, and Escape only cancels the capture', () => {
    let bindings: Bindings = bindingsFrom({});
    const d = {
      ...deps(),
      settings: {
        get: () => DEFAULT_SETTINGS,
        set: vi.fn(),
        fullscreen: null,
        audio: null,
        locales: [{ id: 'en', name: 'English' }],
        keymap: keymapRows({
          bindings: () => bindings,
          set: (next) => {
            bindings = next;
          },
        }),
        build: '0.68.0',
        onChange: () => () => {},
      },
    };
    pauseMenu(document.body, d);
    (document.querySelector('.rl-pause button[data-tab="settings"]') as HTMLButtonElement).click();

    const seen: string[] = [];
    const gameVerbListener = (e: KeyboardEvent): void => {
      seen.push(e.key);
    };
    window.addEventListener('keydown', gameVerbListener);
    try {
      const haltRow = [...document.querySelectorAll<HTMLElement>('.rl-settings__row')].find((r) =>
        r.textContent?.includes('Halt')
      );
      if (!haltRow) throw new Error('no Halt row');
      haltRow.querySelector<HTMLButtonElement>('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(haltRow.querySelector('kbd')?.textContent).toBe('press a key…');

      // A captured, unbound key: rebinds, does not leak, does not resume.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
      expect(seen).toEqual([]);
      expect(d.onResume).not.toHaveBeenCalled();
      expect(document.querySelector('.rl-pause')).not.toBeNull();
      expect(bindings.halt).toBe('j');

      // Arm a second capture and cancel it with Escape: only the capture is
      // cancelled -- the pause menu stays open and does not resume.
      haltRow.querySelector<HTMLButtonElement>('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(haltRow.querySelector('kbd')?.textContent).toBe('press a key…');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(haltRow.querySelector('kbd')?.textContent).toBe('J'); // reverted to the rebind above, not re-captured
      expect(seen).toEqual([]);
      expect(d.onResume).not.toHaveBeenCalled();
      expect(document.querySelector('.rl-pause')).not.toBeNull();
    } finally {
      window.removeEventListener('keydown', gameVerbListener);
    }
  });
});
