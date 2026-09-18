// packages/app/src/ui/keys-overlay.ts
/**
 * F1's overlay (§6): every binding from the same table `settings-keymap.ts`
 * already renders one row per action from -- `ACTIONS` (`input/keymap.ts`).
 * A binding that exists and is not listed here is not expressible, so this
 * reads `ACTIONS` and `deps.bindings()` directly rather than carrying a
 * second copy of either.
 *
 * Modal like `ui/confirm.ts`'s dialog -- a scrim plus a centred `panel()` --
 * but it does NOT self-dispose on Escape or a scrim click. Both call
 * `deps.onClose()` only, exactly like `objectives.ts`'s popover close button:
 * whoever mounted this owns hiding or tearing it down (`main.ts`'s toggle),
 * and this module's own `Disposer` is the one thing that removes it from the
 * document, so a caller that wants "F1 again closes it" gets that by calling
 * the disposer from `onClose`, not by this module guessing at it.
 */
import { ACTIONS, keyLabel, type Bindings } from '../input/keymap';
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
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
    const cap = a.modifier === 'ctrl' ? `${t('keymap.modifier.ctrl')}${key}` : key;
    row(list, a.label, cap, { action: a.id });
  }
  for (const u of UNBOUND_KEYS) {
    row(list, u.label, t(u.keys), { fixed: true });
  }

  scrim.appendChild(p.el);
  host.appendChild(scrim);
  close.focus();

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') deps.onClose();
  };
  const onScrimClick = (ev: MouseEvent): void => {
    if (ev.target === scrim) deps.onClose();
  };
  window.addEventListener('keydown', onKey);
  scrim.addEventListener('click', onScrimClick);

  return () => {
    window.removeEventListener('keydown', onKey);
    scrim.removeEventListener('click', onScrimClick);
    scrim.remove();
  };
}
