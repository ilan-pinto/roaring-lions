// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { closeOpenDialog, confirmDialog, isDialogOpen } from './confirm';

afterEach(() => {
  document.body.replaceChildren();
});

describe('isDialogOpen', () => {
  it('is false with nothing open, true with a confirm, true with a bare .rl-pause', () => {
    expect(isDialogOpen()).toBe(false);
    const scrim = document.createElement('div');
    scrim.className = 'rl-confirm';
    document.body.appendChild(scrim);
    expect(isDialogOpen()).toBe(true);
    scrim.className = 'rl-pause';
    expect(isDialogOpen()).toBe(true);
  });

  // Task 8 fix round 1: C1 -- without this, `main.ts`'s handler-wide guard
  // never learns the key-bindings overlay is up, and Escape opens the pause
  // menu underneath it in the same tick the overlay closes itself.
  it('is true with a bare .rl-keys', () => {
    expect(isDialogOpen()).toBe(false);
    const scrim = document.createElement('div');
    scrim.className = 'rl-keys';
    document.body.appendChild(scrim);
    expect(isDialogOpen()).toBe(true);
  });
});

describe('confirmDialog', () => {
  it('resolves false on Escape and true on the confirm button, and removes itself either way', async () => {
    const host = document.createElement('div');
    const p = confirmDialog(host, {
      title: 'Leave the fight?',
      body: 'This attempt is lost.',
      confirm: 'Leave',
      danger: true,
    }).answer;
    expect(host.querySelector('.rl-confirm')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('.rl-confirm__yes')?.click();
    await expect(p).resolves.toBe(true);
    expect(host.querySelector('.rl-confirm')).toBeNull();

    const q = confirmDialog(host, { title: 't', body: 'b', confirm: 'c' }).answer;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(q).resolves.toBe(false);
    expect(host.querySelector('.rl-confirm')).toBeNull();
  });

  it('focuses Cancel, so an Enter that was meant for the game does not confirm', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    void confirmDialog(host, { title: 't', body: 'b', confirm: 'c' });
    expect(document.activeElement?.classList.contains('rl-confirm__no')).toBe(true);
  });

  it('names what is lost in the body, and stamps the danger colour on the confirm button', () => {
    const host = document.createElement('div');
    void confirmDialog(host, {
      title: 'Start the campaign over?',
      body: 'Your campaign progress, brigade account and tutorial completion are erased.',
      confirm: 'Erase and restart',
      danger: true,
    });
    expect(host.textContent).toContain('Your campaign progress, brigade account and tutorial completion are erased.');
    const yes = host.querySelector<HTMLButtonElement>('.rl-confirm__yes')!;
    expect(yes.textContent).toBe('Erase and restart');
    expect(yes.dataset.danger).toBe('1');
  });

  it('cancels on a click outside the panel, and does not cancel on a click inside it', async () => {
    const host = document.createElement('div');
    const p = confirmDialog(host, { title: 't', body: 'Clicking here must not cancel.', confirm: 'c' }).answer;
    const scrim = host.querySelector<HTMLElement>('.rl-confirm')!;
    const body = host.querySelector<HTMLElement>('.rl-confirm__body')!;
    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Still up: the click landed on the panel, not the scrim itself.
    expect(host.querySelector('.rl-confirm')).not.toBeNull();
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(p).resolves.toBe(false);
  });

  it('has no danger attribute on the confirm button when the action is not destructive', () => {
    const host = document.createElement('div');
    void confirmDialog(host, { title: 't', body: 'b', confirm: 'c' });
    const yes = host.querySelector<HTMLButtonElement>('.rl-confirm__yes')!;
    expect(yes.dataset.danger).toBeUndefined();
  });

  // fix round 1: removing the focused Cancel button from the document used to
  // drop focus to <body> with nothing restoring it -- a keyboard player who
  // opened the dialog lost their tab position entirely. `role="dialog"` +
  // `aria-modal` is a claim of the WAI-ARIA modal pattern, and returning
  // focus to the opener on close is that pattern's own expectation.
  it('returns focus to the element that opened it, once the dialog closes on Escape', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const p = confirmDialog(host, { title: 't', body: 'b', confirm: 'c' }).answer;
    expect(document.activeElement?.classList.contains('rl-confirm__no')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
    expect(document.activeElement).toBe(opener);
  });

  // I5: main.ts's window keydown listener issues game verbs ('h' halt, 'o'
  // overlay toggle, ...) with no modal guard. Reproduced here with a stand-in
  // bubble-phase `window` listener rather than importing main.ts (which pulls
  // in the whole renderer/sim boot) -- what matters is the SHAPE, a
  // bubble-phase listener on the same target the dialog itself uses, added
  // BEFORE the dialog opens, exactly like main.ts's real one. Dispatched on
  // `document.body` with `bubbles: true` rather than directly on `window`,
  // because a direct `window.dispatchEvent` makes window both the event's
  // target AND the only node in its path, which collapses capture- and
  // bubble-registered listeners on it into plain registration order and
  // would prove nothing about phase ordering -- the real game hands focus to
  // a genuine descendant, so window is a true ANCESTOR the event bubbles
  // through, which is what makes capture-before-bubble ordering apply at all.
  it('stops a game-verb key from reaching a bubble-phase window listener while open', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const seen: string[] = [];
    const gameVerbListener = (e: KeyboardEvent): void => {
      seen.push(e.key);
    };
    window.addEventListener('keydown', gameVerbListener);
    try {
      const p = confirmDialog(host, { title: 't', body: 'b', confirm: 'c' }).answer;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      expect(seen).toEqual([]);

      // Escape/Enter/Tab still reach it -- the dialog's own cancel key, a
      // focused button's native activation, and focus movement are not
      // swallowed, only every OTHER key is.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(seen).toEqual(['Enter', 'Tab']);

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await expect(p).resolves.toBe(false);
      expect(seen).toEqual(['Enter', 'Tab', 'Escape']);

      // The guard is scoped to the dialog's own lifetime: once it is closed,
      // the same key reaches the listener again.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      expect(seen).toEqual(['Enter', 'Tab', 'Escape', 'h']);
    } finally {
      window.removeEventListener('keydown', gameVerbListener);
    }
  });

  // C1: the handle's own contract. `saves.test.ts` drives the same fix through
  // a real Router; this pins the three parts in isolation -- the listeners come
  // off, the promise settles false rather than hanging forever, and a second
  // call (both the router AND the battlefield teardown reach for it) is a
  // no-op rather than a double resolve.
  it('closeOpenDialog cancels the open dialog, releases its key guard, and is idempotent', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const seen: string[] = [];
    const gameVerbListener = (e: KeyboardEvent): void => void seen.push(e.key);
    window.addEventListener('keydown', gameVerbListener);
    try {
      const h = confirmDialog(host, { title: 't', body: 'b', confirm: 'c' });
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      expect(seen).toEqual([]);

      closeOpenDialog();
      await expect(h.answer).resolves.toBe(false);
      expect(host.querySelector('.rl-confirm')).toBeNull();
      expect(isDialogOpen()).toBe(false);

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      expect(seen).toEqual(['h']);

      // Twice, and after an answer: neither throws nor re-settles.
      closeOpenDialog();
      h.close();
      await expect(h.answer).resolves.toBe(false);
    } finally {
      window.removeEventListener('keydown', gameVerbListener);
    }
  });

  it('leaves nothing to close once the player has answered', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = confirmDialog(host, { title: 't', body: 'b', confirm: 'c' });
    host.querySelector<HTMLButtonElement>('.rl-confirm__yes')!.click();
    await expect(h.answer).resolves.toBe(true);
    // The slot was released by the answer, so a later teardown cannot cancel a
    // dialog that is no longer there -- nor resolve this promise a second time.
    closeOpenDialog();
    await expect(h.answer).resolves.toBe(true);
  });
});