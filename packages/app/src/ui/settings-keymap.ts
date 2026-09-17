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
 */
import { ACTIONS, bindingsFrom, keyLabel, rebind, type Bindings } from '../input/keymap';

export interface KeymapDeps {
  bindings(): Bindings;
  set(next: Bindings): void;
  mount(table: HTMLElement): void;
}

const CONFLICT_HINT_MS = 2000;

export function keymapRows(deps: { bindings(): Bindings; set(next: Bindings): void }): KeymapDeps {
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
      label.textContent = a.label;
      row.appendChild(label);

      const control = document.createElement('div');
      control.className = 'rl-settings__control';

      const kbd = document.createElement('kbd');
      kbd.className = 'rl-keymap__key';
      const paint = (): void => {
        const key = keyLabel(deps.bindings()[a.id]);
        kbd.textContent = a.modifier === 'ctrl' ? `ctrl + ${key}` : key;
      };
      paint();
      paints.push(paint);
      control.appendChild(kbd);

      const hint = document.createElement('div');
      hint.className = 'rl-settings__hint';
      let hintTimer: ReturnType<typeof setTimeout> | undefined;

      if (a.rebindable) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rl-btn';
        btn.textContent = 'Change';
        btn.addEventListener('click', () => {
          kbd.textContent = 'press a key…';
          const capture = (ev: KeyboardEvent): void => {
            ev.preventDefault();
            window.removeEventListener('keydown', capture, true);
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
            const holder = ACTIONS.find((x) => x.id === result.takenBy)?.label ?? result.takenBy;
            hint.textContent = `Already used by ${holder}`;
            clearTimeout(hintTimer);
            hintTimer = setTimeout(() => {
              hint.textContent = '';
            }, CONFLICT_HINT_MS);
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
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.addEventListener('click', () => {
      deps.set(bindingsFrom({}));
      for (const paint of paints) paint();
    });
    resetControl.appendChild(resetBtn);
    resetRow.appendChild(resetControl);
    table.appendChild(resetRow);
  };

  return { bindings: deps.bindings, set: deps.set, mount };
}
