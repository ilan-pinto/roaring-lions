// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindingsFrom, passesThroughModal, resolveKey, type Bindings } from '../input/keymap';
import { DEFAULT_SETTINGS } from '../settings';
import { LOCALES } from '../i18n/locales';
import { confirmDialog, isDialogOpen } from './confirm';
import { pauseMenu } from './pause';
import { keymapRows } from './settings-keymap';

function deps() {
  return {
    objectives: () => [
      { id: 'crossroads', text: 'Take the crossroads', primary: true, carries: false, status: 'active' as const },
      { id: 'no_losses', text: 'Lose no one', primary: false, carries: false, status: 'failed' as const },
    ],
    paysCredits: true,
    onResume: vi.fn(),
    onRestart: vi.fn(),
    onQuit: vi.fn(),
    settings: {
      get: () => DEFAULT_SETTINGS,
      set: vi.fn(),
      fullscreen: null,
      audio: null,
      locales: LOCALES,
      keymap: null,
      build: '0.68.0',
      onChange: () => () => {},
    },
    build: '0.68.0',
    // No test here exercises panning by default -- see the dedicated
    // isPanKey test below, which supplies its own. Typed with the parameter
    // so a test that overwrites it with a real predicate still typechecks.
    isPanKey: ((): boolean => false) as (ev: KeyboardEvent) => boolean,
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
    // I10: the status column is catalogue text, not the sim's own enum word.
    // Asserting "not the enum" is what catches a regression to
    // `status.textContent = o.status`; the English spelling alone would not.
    // `.rl-obj__status`, not `.rl-pause__obj-status`, since task 6: the tab
    // mounts the shared `objectives.ts` panel now, which owns this class.
    const words = [...(dlg?.querySelectorAll('.rl-obj__status') ?? [])].map((e) => e.textContent);
    expect(words).toEqual(['In progress', 'Failed']);
    expect(words).not.toContain('active');
    expect(words).not.toContain('failed');
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
  // the capture guard exempts whatever `deps.isPanKey` names alongside
  // Escape/Enter/Tab, unlike a plain confirmDialog which has no reason to.
  // Fix round 1: this used to be a hardcoded WASD/arrow set, wrong the
  // moment a player rebound one of those letters. `isPanKey` is now the
  // live answer `bootBattlefield` builds from its own `bindings` through
  // `resolveKey` -- proved here with a stand-in that maps a DIFFERENT key
  // ('j') to true, so the test cannot pass by coincidentally matching a
  // hardcoded default.
  it('pan keys are read from isPanKey (bindings-driven), not hardcoded -- a bound pan key passes, a non-pan key does not', () => {
    const d = { ...deps(), isPanKey: (ev: KeyboardEvent) => ev.key === 'j' };
    pauseMenu(document.body, d);
    const seen: string[] = [];
    const gameVerbListener = (e: KeyboardEvent): void => {
      seen.push(e.key);
    };
    window.addEventListener('keydown', gameVerbListener);
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      expect(seen).toEqual(['j']);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      expect(seen).toEqual(['j']); // 'h' did not reach it
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
      const p = confirmDialog(document.body, { title: 'Restart the mission?', body: 'b', confirm: 'Restart', danger: true }).answer;
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
        locales: LOCALES,
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

  // Fix round 1 -- the Escape race. `main.ts`'s real keydown listener is the
  // OLDEST bubble listener on `window` (registered once at boot, long before
  // any dialog exists), so on a bare Escape it used to run BEFORE any
  // dialog's own Escape handler and act on its own idea of what Escape means
  // -- see `isDialogOpen`'s own header in confirm.ts. `gameKeydown` below is
  // a stand-in for the FIXED shape,
  // `case 'pause': if (!paused && !isDialogOpen() && !missionEnded) pause();`,
  // registered before the pause menu opens, exactly like the real one.
  //
  // Minor 16 (final review): this stand-in used to carry only the
  // `isDialogOpen()` third of that condition, so it mirrored one clause of
  // three and the comment above overstated it. `paused` and `missionEnded` are
  // real local state here now, and `paused` is driven by the menu's own
  // `onResume` the way `bootBattlefield`'s is -- so an Escape that reaches the
  // game while the menu is already up is refused for the same two reasons the
  // real handler refuses it.
  it('the game only OPENS the pause menu: Escape belongs to whichever dialog is open, so cancelling a stacked confirm neither resumes the game nor leaks to it', async () => {
    const d = deps();
    const spy = vi.fn();
    let paused = false;
    const missionEnded = false;
    d.onResume.mockImplementation(() => {
      paused = false;
    });
    const gameKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !paused && !isDialogOpen() && !missionEnded) spy();
    };
    window.addEventListener('keydown', gameKeydown);
    try {
      pauseMenu(document.body, d);
      paused = true;
      (document.querySelector('.rl-pause button[data-act="restart"]') as HTMLButtonElement).click();
      expect(d.onRestart).toHaveBeenCalledTimes(1);
      // main.ts's real onRestart opens exactly this, stacked over the pause modal.
      const p = confirmDialog(document.body, { title: 'Restart the mission?', body: 'b', confirm: 'Restart', danger: true }).answer;

      // Escape cancels the CONFIRM -- the pause menu underneath is untouched,
      // the game never sees it (a dialog was open throughout), and the pause
      // menu does not resume out from under it.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await expect(p).resolves.toBe(false);
      expect(document.querySelector('.rl-confirm')).toBeNull();
      expect(document.querySelector('.rl-pause')).not.toBeNull();
      expect(d.onResume).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();

      // Escape again, now that only the pause menu itself is open: THIS one resumes.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(d.onResume).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.rl-pause')).toBeNull();
    } finally {
      window.removeEventListener('keydown', gameKeydown);
    }
  });

  it('a bare confirmDialog (the HUD leave button, no pause menu involved) does not spuriously reach the game handler on Escape', async () => {
    const spy = vi.fn();
    const gameKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !isDialogOpen()) spy();
    };
    window.addEventListener('keydown', gameKeydown);
    try {
      const p = confirmDialog(document.body, { title: 'Leave the mission?', body: 'b', confirm: 'Leave', danger: true }).answer;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await expect(p).resolves.toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', gameKeydown);
    }
  });

  // I1 (final review). Both modals deliberately let Tab through so the
  // browser's native focus traversal works inside the dialog -- and `main.ts`
  // binds Tab to `cycleChips`, so before the handler-wide guard a Tab pressed
  // in the pause menu ran `hud.cycleChipFocus()`, moved the lime focus frame
  // along the HUD chips BEHIND the modal, and then `preventDefault()`ed the
  // very focus move the dialog had passed Tab through for.
  //
  // `gameKeydown` mirrors `main.ts`'s handler exactly: `resolveKey`, then the
  // one guard, then the `cycleChips` case -- and it imports
  // `passesThroughModal` rather than restating it, so a mutation of the real
  // predicate turns this red. Both directions were falsified by hand: forcing
  // it to `true` lets Tab through and fails the first half; forcing it to
  // `false` blocks the pan and fails the second.
  //
  // jsdom implements no Tab traversal, so `document.activeElement` cannot say
  // whether focus MOVED. What it can say -- and what the defect actually was
  // -- is whether the game cancelled the browser's default action, so
  // `defaultPrevented` is the reading.
  it('Tab does not reach the game through the open modal, while a pan key still does', () => {
    const bindings = bindingsFrom({});
    const d = deps();
    d.isPanKey = (ev: KeyboardEvent) => passesThroughModal(resolveKey(bindings, ev));
    const cycleChipFocus = vi.fn(() => true);
    const acted: string[] = [];
    const gameKeydown = (ev: KeyboardEvent): void => {
      const action = resolveKey(bindings, ev);
      if (isDialogOpen() && !passesThroughModal(action)) return;
      if (action === 'cycleChips') {
        if (cycleChipFocus()) ev.preventDefault();
        return;
      }
      if (action !== null) acted.push(action);
    };
    window.addEventListener('keydown', gameKeydown);
    try {
      // Negative control first, with nothing open: Tab IS the game's key.
      const before = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.body.dispatchEvent(before);
      expect(cycleChipFocus).toHaveBeenCalledTimes(1);
      expect(before.defaultPrevented).toBe(true);

      pauseMenu(document.body, d);
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.body.dispatchEvent(tab);
      expect(cycleChipFocus).toHaveBeenCalledTimes(1); // still 1: the modal's Tab is the modal's
      expect(tab.defaultPrevented).toBe(false);
      expect(document.activeElement?.closest('.rl-pause')).not.toBeNull();

      // A game verb the modal passes NOTHING of: blocked twice over.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      expect(acted).toEqual([]);

      // ...but the camera still pans, which is the pause menu's own deliberate
      // exemption (`isPanKey`) and the only thing `passesThroughModal` allows.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(acted).toEqual(['panUp', 'panRight']);
    } finally {
      window.removeEventListener('keydown', gameKeydown);
    }
  });

  // The same guard, over a bare confirm rather than the pause menu -- where
  // the pan exemption does NOT apply, because `confirm.ts` stops pan keys in
  // the capture phase (a player answering "leave the mission?" is not looking
  // around). Two independent reasons to refuse, and the test proves the outer
  // one by reading the game's own record rather than the dialog's.
  it('a game verb pressed under a bare confirm reaches no action', () => {
    const bindings = bindingsFrom({});
    const acted: string[] = [];
    const gameKeydown = (ev: KeyboardEvent): void => {
      const action = resolveKey(bindings, ev);
      if (isDialogOpen() && !passesThroughModal(action)) return;
      if (action !== null) acted.push(action);
    };
    window.addEventListener('keydown', gameKeydown);
    try {
      void confirmDialog(document.body, { title: 'Leave the mission?', body: 'b', confirm: 'Leave', danger: true });
      for (const key of ['h', 'f', 'o', 'g', 'u', 'b', 'm', 'Tab']) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
      expect(acted).toEqual([]);
    } finally {
      window.removeEventListener('keydown', gameKeydown);
    }
  });

  // Task 6 (R-7: one component, three mounts): the Objectives tab is not this
  // module's own list any more -- it is the SAME `objectivesPanel` the
  // in-mission tracker and the briefing mount, so a reward line and the
  // `.rl-obj` row shape appear here for free rather than needing a second
  // implementation.
  it('the Objectives tab is the shared panel, with rewards on the secondaries', () => {
    pauseMenu(document.body, {
      ...deps(),
      objectives: () => [
        { id: 'a', text: 'Take it', primary: true, carries: false, status: 'active' as const },
        { id: 'd', text: 'Mark the cache', primary: false, carries: true, status: 'active' as const },
      ],
      paysCredits: true,
    });
    expect(document.body.querySelectorAll('.rl-obj')).toHaveLength(2);
    expect(document.body.querySelector('.rl-obj[data-id="d"] .rl-obj__reward')?.textContent).toContain('40');
    expect(document.body.querySelector('.rl-pause__list')).toBeNull(); // the old <ol> is gone
  });
});