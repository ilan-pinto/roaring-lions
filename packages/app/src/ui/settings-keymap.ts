// packages/app/src/ui/settings-keymap.ts
/**
 * Task 5's Controls section: one row per `input/keymap.ts` action, mounted
 * into the settings table by `settings-panel.ts` (gated on `deps.keymap !==
 * null`), plus a trailing "Reset to defaults" row.
 *
 * A row shows the action's CURRENT keycap in a `<kbd>` and, for a rebindable
 * action, a "Change" button. Clicking it puts the kbd into capture mode
 * ("press a key…") and installs a ONE-SHOT capture-phase `keydown` on
 * `window` — capture rather than bubble so it wins over a running
 * battlefield's own listener once Task 6 mounts this panel over a mission.
 * Escape cancels; anything else asks `rebind`, which is the one and only
 * place a collision is decided. A refusal names the action that already
 * holds the key and reverts the kbd; `deps.set` is called only on success,
 * which is the whole of what keeps a rebind from silently overwriting
 * another binding.
 *
 * Two things fixed in review round 1, both about what happens BETWEEN a
 * click and a keypress, which the brief's sketch did not cover.
 *
 * **Only one capture is ever pending.** `cancelPending`, at `keymapRows`
 * scope rather than per-row, holds whichever capture is currently armed.
 * Clicking "Change" on a second row (or the same row again) cancels the
 * first — removes its listener and repaints ITS kbd back to its own current
 * binding — before installing the new one. Without this, clicking "Change"
 * on Halt and then on Smoke without pressing a key would leave TWO live
 * `keydown` listeners on `window`; the next keypress would fire whichever
 * was registered LAST for a `holder` lookup, but the FIRST listener would
 * still be sitting there, `removeEventListener`-able only by itself, so it
 * would consume the key AFTER the second one already had (both call
 * `stopImmediatePropagation`, so in practice one silently eats the other's
 * keystroke) — a capture that outlives the click that started it. `dispose`
 * calls it too, so leaving `/settings` (or Task 6 closing the pause menu)
 * mid-capture cannot leave a listener on `window` answering to a screen that
 * is no longer there.
 *
 * **The captured keydown must not reach anything else.** `preventDefault`
 * alone stops the browser's own handling (e.g. Tab moving focus) but not
 * OTHER listeners on `window` — a mission running underneath a Task 6 pause
 * overlay has its own bubble-phase `keydown` listener (`main.ts`), and
 * without `stopPropagation`/`stopImmediatePropagation` a captured "press a
 * key" for a rebind would ALSO drive the battlefield (e.g. capturing `f`
 * for a new Smoke binding would also quick-cast smoke). Capture phase runs
 * before bubble phase on every ancestor, so stopping propagation here is
 * enough to keep it from ever reaching that listener at all.
 */
import { t } from '../i18n/t';
import { ACTIONS, bindingsFrom, keyLabel, rebind, type Bindings } from '../input/keymap';

export interface KeymapDeps {
  bindings(): Bindings;
  set(next: Bindings): void;
  mount(table: HTMLElement): void;
  /** Cancels a pending capture (repainting its row) and clears every hint
   *  timer. `settingsPanel`'s own dispose calls this, so navigating away
   *  mid-capture — or mid-hint — leaves nothing listening on `window`. */
  dispose(): void;
}

const CONFLICT_HINT_MS = 2000;

export function keymapRows(deps: { bindings(): Bindings; set(next: Bindings): void }): KeymapDeps {
  /** Cancels whichever capture is currently armed, if any. Set when a
   *  capture starts, cleared when it resolves (a key lands or Escape
   *  cancels it) or when this function itself runs. Table-wide rather than
   *  per-row because there is only ever ONE capture at a time across every
   *  row. */
  let cancelPending: (() => void) | null = null;
  /** Every live "Already used by…" auto-clear timer, table-wide, so
   *  `dispose` can drain all of them rather than just the one row that
   *  happens to be mid-capture. */
  const hintTimers = new Set<ReturnType<typeof setTimeout>>();

  const mount = (table: HTMLElement): void => {
    // Every row's own repaint, so "Reset to defaults" (the one action that
    // changes every binding at once rather than just its own row's) can
    // update every kbd rather than leaving the others stale until the panel
    // is remounted. A single rebind never needs this list -- `rebind` only
    // ever changes the ONE binding it was asked for -- so it still calls its
    // own `paint` directly.
    const paints: (() => void)[] = [];
    for (const a of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'rl-settings__row';

      const label = document.createElement('label');
      // `a.label` is a catalogue KEY (`input/keymap.ts`'s `ActionSpec.label`
      // own doc comment), not text -- resolved here, at render time.
      label.textContent = t(a.label);
      row.appendChild(label);

      const control = document.createElement('div');
      control.className = 'rl-settings__control';

      const kbd = document.createElement('kbd');
      kbd.className = 'rl-keymap__key';
      const paint = (): void => {
        const key = keyLabel(deps.bindings()[a.id]);
        // Fix wave I4: this used to be a bare `ctrl + ` literal, the one
        // spelling of the modifier prefix that never went through `t()` --
        // `keymap.modifier.ctrl` (`en.json`, "Ctrl + ") already existed for
        // Task 8's keys overlay, which reads it correctly; this row was the
        // second, uncaught copy.
        kbd.textContent = a.modifier === 'ctrl' ? `${t('keymap.modifier.ctrl')}${key}` : key;
      };
      paint();
      paints.push(paint);
      control.appendChild(kbd);

      const hint = document.createElement('div');
      hint.className = 'rl-settings__hint';
      let hintTimer: ReturnType<typeof setTimeout> | undefined;
      const showHint = (text: string): void => {
        hint.textContent = text;
        if (hintTimer !== undefined) {
          clearTimeout(hintTimer);
          hintTimers.delete(hintTimer);
        }
        hintTimer = setTimeout(() => {
          hint.textContent = '';
          if (hintTimer !== undefined) hintTimers.delete(hintTimer);
          hintTimer = undefined;
        }, CONFLICT_HINT_MS);
        hintTimers.add(hintTimer);
      };

      if (a.rebindable) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rl-btn';
        btn.textContent = t('settings.keymap.change');
        btn.addEventListener('click', () => {
          // At most one capture pending at a time -- see the file header.
          cancelPending?.();
          kbd.textContent = t('settings.keymap.capturing');
          const capture = (ev: KeyboardEvent): void => {
            ev.preventDefault();
            // Both: `stopPropagation` keeps it from reaching an ANCESTOR's
            // listener (nothing above `window`, but stated for the reader);
            // `stopImmediatePropagation` keeps it from reaching another
            // listener registered on `window` ITSELF, bubble-phase included
            // -- a running battlefield's keydown listener is exactly that.
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            window.removeEventListener('keydown', capture, true);
            cancelPending = null;
            if (ev.key === 'Escape') {
              paint();
              return;
            }
            const result = rebind(deps.bindings(), a.id, ev.key);
            if (result.ok) {
              deps.set(result.bindings);
              paint();
              return;
            }
            paint();
            // `.label` is a catalogue key (ActionSpec's own doc comment);
            // translate it, and fall back to the bare action id untranslated
            // -- same as the label lookup missing altogether, which cannot
            // happen in practice but costs nothing to fall back safely.
            const holderKey = ACTIONS.find((x) => x.id === result.takenBy)?.label;
            const holder = holderKey ? t(holderKey) : result.takenBy;
            showHint(t('settings.keymap.conflict', { holder }));
          };
          cancelPending = () => {
            window.removeEventListener('keydown', capture, true);
            cancelPending = null;
            paint(); // back to this row's own current binding
          };
          window.addEventListener('keydown', capture, true);
        });
        control.appendChild(btn);
      }

      control.appendChild(hint);
      row.appendChild(control);
      table.appendChild(row);
    }

    const resetRow = document.createElement('div');
    resetRow.className = 'rl-settings__row';
    const resetControl = document.createElement('div');
    resetControl.className = 'rl-settings__control';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'rl-btn';
    resetBtn.textContent = t('settings.keymap.reset');
    resetBtn.addEventListener('click', () => {
      deps.set(bindingsFrom({}));
      for (const paint of paints) paint();
    });
    resetControl.appendChild(resetBtn);
    resetRow.appendChild(resetControl);
    table.appendChild(resetRow);
  };

  const dispose = (): void => {
    cancelPending?.();
    for (const t of hintTimers) clearTimeout(t);
    hintTimers.clear();
  };

  return { bindings: deps.bindings, set: deps.set, mount, dispose };
}
