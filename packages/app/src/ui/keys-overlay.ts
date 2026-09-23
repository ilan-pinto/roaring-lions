// packages/app/src/ui/keys-overlay.ts
/**
 * F1's overlay (§6): every binding from the same table `settings-keymap.ts`
 * already renders one row per action from -- `ACTIONS` (`input/keymap.ts`).
 * A binding that exists and is not listed here is not expressible, so this
 * reads `ACTIONS` and `deps.bindings()` directly rather than carrying a
 * second copy of either.
 *
 * Modal like `ui/confirm.ts`'s dialog -- a scrim plus a centred `panel()` --
 * but it does NOT self-dispose on Escape or its own binding. Both call
 * `deps.onClose()` only, exactly like `objectives.ts`'s popover close button:
 * whoever mounted this owns hiding or tearing it down (`main.ts`'s toggle),
 * and this module's own `Disposer` is the one thing that removes it from the
 * document, so a caller that wants "F1 again closes it" gets that by calling
 * the disposer from `onClose`, not by this module guessing at it.
 *
 * Task 8 fix round 1 (C1): this is a real dialog and has to behave like one.
 * `.rl-keys` joined `isDialogOpen()`'s selector (`ui/confirm.ts`), so
 * `main.ts`'s handler-wide guard refuses `pause` AND `keysOverlay` while the
 * card is up -- but that guard only protects `main.ts`'s OWN listener, and
 * before this fix the overlay had only a bubble-phase `keydown` listener of
 * its own, so every other game verb (`halt`, `smoke`, `mute`, Tab's
 * `cycleChips`, ...) kept firing under the card, and a bare Escape reached
 * `main.ts` first (registered at boot, oldest listener on `window`) and
 * opened the pause menu in the same tick this module's own listener closed
 * the overlay. `onCaptureKey` below mirrors `pause.ts`'s own guard: it
 * `stopPropagation()`s everything except Escape, Tab, and the overlay's own
 * binding (read live, so a rebind still closes it). No pan-key exemption --
 * this is a reference card over a mission, not `pause.ts`'s "modal over a
 * world that keeps drawing while the sim stops".
 *
 * Task 8 (R-9): Tab used to fall straight through the guard above with
 * nothing catching it -- the browser has no native tab order to fall back
 * on either, since this is a plain `<div>` scrim, not a `<dialog>`. `focusTrap`
 * (installed right after the panel is built, below) is what actually cycles
 * focus within the card now.
 */
import { ACTIONS, keyLabel, resolveKey, type Bindings } from '../input/keymap';
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { focusTrap } from './focus-trap';
import { panel } from './panel';

export interface KeysOverlayDeps {
  /** Read fresh at mount, not closed over as a snapshot from further up --
   *  the live table, the same way `settings-keymap.ts` paints its rows. */
  bindings(): Bindings;
  onClose(): void;
}

/** Real bindings that are deliberately NOT in `ACTIONS`, and why each is
 *  outside it. `keymap.ts`'s own header states the rule for the first: every
 *  RTS player expects control groups on exactly those keys, so the digits are
 *  refused as rebind targets. The two mouse buttons are not keys at all, so
 *  there is nothing for a keyboard table to hold. A player does not care about
 *  any of that and needs all four listed. */
export const UNBOUND_KEYS: readonly { label: string; keys: string }[] = [
  { label: 'keys.groups.assign', keys: 'keys.cap.ctrlDigit' },
  { label: 'keys.groups.recall', keys: 'keys.cap.digit' },
  { label: 'keys.select', keys: 'keys.cap.lmb' },
  { label: 'keys.order', keys: 'keys.cap.rmb' },
];

function row(list: HTMLElement, labelKey: string, capText: string, opts: { action?: string; fixed?: boolean }): void {
  const li = document.createElement('li');
  li.className = opts.fixed ? 'rl-keys__row--fixed' : 'rl-keys__row';
  if (opts.action) li.dataset.action = opts.action;

  const label = document.createElement('span');
  label.className = 'rl-keys__label';
  label.textContent = t(labelKey);
  li.appendChild(label);

  const cap = document.createElement('span');
  cap.className = 'rl-keys__cap';
  cap.textContent = capText;
  li.appendChild(cap);

  list.appendChild(li);
}

export function showKeysOverlay(host: HTMLElement, deps: KeysOverlayDeps): Disposer {
  const scrim = document.createElement('div');
  scrim.className = 'rl-keys';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');

  const p = panel({ rank: 'inspect', title: t('keys.title') });
  p.el.classList.add('rl-keys__panel');
  // Installed here, before the close button and the row list exist: it
  // queries `p.el` for its own focusable descendants at KEYPRESS time, not
  // now, so every row appended below is covered with no ordering requirement
  // on this line.
  const disposeTrap = focusTrap(p.el);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'rl-btn rl-keys__close';
  close.textContent = t('keys.close');
  close.addEventListener('click', () => deps.onClose());
  p.body.appendChild(close);

  const list = document.createElement('ul');
  list.className = 'rl-keys__list';
  p.body.appendChild(list);

  const bindings = deps.bindings();
  for (const a of ACTIONS) {
    const key = keyLabel(bindings[a.id]);
    // One catalogue call for the WHOLE keycap, not a modifier fragment
    // resolved through `t()` on its own and then glued to a bare, untranslated
    // key: `keymap.modifier.ctrl` ("Ctrl + ") is `settings-keymap.ts`'s own
    // key and stays exactly that for its caller, but composing THIS keycap
    // that way is the concatenation-around-`t()` shape the i18n validator's
    // sink-adjacent regex cannot see -- under the pseudo-locale the modifier
    // half comes back bracketed and the key half does not, so the two read as
    // separate words glued together. `keymap.cap.ctrl` takes the key as its
    // own `{key}` param, so the whole string is formatted and then
    // pseudo-transformed as ONE unit.
    const cap = a.modifier === 'ctrl' ? t('keymap.cap.ctrl', { key }) : key;
    row(list, a.label, cap, { action: a.id });
  }
  for (const u of UNBOUND_KEYS) {
    row(list, u.label, t(u.keys), { fixed: true });
  }

  // Remembered on show, restored on close/dispose when still connected.
  // Mirrors `confirmDialog`'s `opener`. `focusTrap` above now owns
  // Tab/Shift+Tab while the card is open; this is only what hands the
  // keyboard back once it closes.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  scrim.appendChild(p.el);
  host.appendChild(scrim);
  close.focus();

  // Is this keydown the overlay's OWN binding (normally F1, but read live --
  // a rebind onto another key must still close it)? Goes through the same
  // `resolveKey` `main.ts`'s own listener uses, rather than a raw string
  // compare, so case, the space-bar spelling and a future modifier all agree
  // with the rest of the keymap.
  const isOwnKey = (ev: KeyboardEvent): boolean =>
    resolveKey(deps.bindings(), { key: ev.key, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey }) === 'keysOverlay';

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      deps.onClose();
      return;
    }
    if (isOwnKey(ev)) {
      // F1 is the browser's own help key; `main.ts`'s `case 'keysOverlay':`
      // no longer runs while this is open (the capture guard below stops the
      // event before it gets there), so this is now the only preventDefault
      // a second F1 gets.
      ev.preventDefault();
      deps.onClose();
    }
  };
  // See `pause.ts`'s `onCaptureKey` for the phase reasoning this mirrors.
  // Escape and Tab pass through untouched (Escape is this dialog's own
  // cancel above, a bubble listener on the same target; Tab is `focusTrap`'s
  // job now, not this guard's), and so does the overlay's own binding, which
  // needs to reach `onKey` above to close it. Every other key -- game verbs,
  // the control-group digits, everything -- is swallowed: unlike `pause.ts`
  // there is no pan-key exemption, because this is a reference card over a
  // mission, not a modal over a world that keeps drawing while the sim
  // stops.
  const onCaptureKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' || ev.key === 'Tab' || isOwnKey(ev)) return;
    ev.stopPropagation();
  };
  const onScrimClick = (ev: MouseEvent): void => {
    if (ev.target === scrim) deps.onClose();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onCaptureKey, true);
  scrim.addEventListener('click', onScrimClick);

  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keydown', onCaptureKey, true);
    disposeTrap();
    scrim.removeEventListener('click', onScrimClick);
    scrim.remove();
    if (opener?.isConnected) opener.focus();
  };
}
