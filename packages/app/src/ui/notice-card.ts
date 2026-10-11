// The modal notice card, extracted from the phone notice (K-17, `small-screen.ts`)
// when the no-graphics-card notice (`no-gpu.ts`) became its second user.
//
// It is the boot-failure card's own pieces (`.rl-boot-scrim` / `.rl-boot-error`
// / `.rl-btn`) as a modal dialog, and everything that makes it modal lives
// here ONCE, because the parts are subtle and a second copy is how they drift:
//   - Escape answers the card (`onEscape`) and every other key except Tab and
//     Enter is swallowed, so the game and the pause menu do not answer under
//     it (`isDialogOpen()` must know the scrim's class, `confirm.ts`);
//   - focus is trapped in the card, and focus that a screen under it pulls
//     elsewhere (the briefing's Deploy button) is pulled back to the first
//     button;
//   - everything it adds -- two `window`/`document` listeners, the trap, the
//     scrim -- is taken away by `close()` (the disposer contract in CLAUDE.md),
//     which is idempotent, and focus goes back to whoever had it.
//
// TWO CARDS AT ONCE WOULD LOOP. Each card's `focusin` guard pulls focus back
// into itself when it lands outside, so with two cards open each would pull
// from the other for ever. Callers therefore never mount a second card while
// one is open (`isDialogOpen`); `no-gpu.ts` checks.
import { focusTrap } from './focus-trap';

export interface NoticeButton {
  /** Classes on the `<button>`; always includes `rl-btn`. */
  className: string;
  label: string;
  onClick: () => void;
}

export interface NoticeSpec {
  /** Classes on the scrim, e.g. `rl-boot-scrim rl-no-gpu`. */
  scrimClass: string;
  /** Prefix for the title/body ids that `aria-labelledby` points at. */
  idBase: string;
  title: string;
  body: string;
  next: string;
  /** The first button takes the focus. */
  buttons: NoticeButton[];
  /** Escape: usually the same as the first button. */
  onEscape: () => void;
}

export interface NoticeHandle {
  /** Take the card and everything it added away. Idempotent. */
  close: () => void;
}

export function mountNotice(win: Window, spec: NoticeSpec): NoticeHandle {
  const doc = win.document;
  const opener = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

  const scrim = doc.createElement('div');
  scrim.className = spec.scrimClass;
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  scrim.setAttribute('aria-labelledby', `${spec.idBase}-title`);
  scrim.setAttribute('aria-describedby', `${spec.idBase}-body`);

  const card = doc.createElement('div');
  card.className = 'rl-boot-error';

  const h = doc.createElement('h2');
  h.id = `${spec.idBase}-title`;
  h.className = 'rl-boot-error__title';
  h.textContent = spec.title;
  card.appendChild(h);

  const p = doc.createElement('p');
  p.id = `${spec.idBase}-body`;
  p.className = 'rl-boot-error__body';
  p.textContent = spec.body;
  card.appendChild(p);

  const n = doc.createElement('p');
  n.className = 'rl-boot-error__next';
  n.textContent = spec.next;
  card.appendChild(n);

  const row = doc.createElement('div');
  row.className = 'rl-boot-error__actions';
  const buttons = spec.buttons.map((b) => {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = b.className;
    el.textContent = b.label;
    el.addEventListener('click', b.onClick);
    return el;
  });
  row.append(...buttons);
  card.appendChild(row);
  scrim.appendChild(card);

  const first = buttons[0];
  const disposeTrap = focusTrap(card);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Tab' || e.key === 'Enter') return;
    e.stopPropagation();
    if (e.key === 'Escape') spec.onEscape();
  };
  const onFocusIn = (e: FocusEvent): void => {
    if (e.target instanceof Node && !scrim.contains(e.target)) first?.focus({ preventScroll: true });
  };
  win.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocusIn);
  doc.body.appendChild(scrim);
  first?.focus();

  let closed = false;
  return {
    close: () => {
      if (closed) return;
      closed = true;
      win.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('focusin', onFocusIn);
      disposeTrap();
      const hadFocus = scrim.contains(doc.activeElement);
      scrim.remove();
      if (hadFocus) opener?.focus();
    },
  };
}
