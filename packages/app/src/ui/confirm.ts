// One confirm dialog for everything that destroys player state: leaving a
// mission mid-fight, wiping the campaign ledger. Before this, both of those
// were a plain navigation with nothing standing in the way -- worse, the
// briefing screen's own Escape and a stray click anywhere on it DEPLOYED the
// mission nobody meant to start (`loading.ts`'s old `pointerdown` listener).
// Nothing in the shell ever asked "are you sure", and the one thing worth
// asking about was never named.
//
// Reuses `panel()` (`ui/panel.ts`) for the stamped band rather than hand-
// rolling one -- the same band/body identity every other panel in the shell
// wears, so a confirm reads as part of the same system instead of a bespoke
// popup. `rl-band` does not exist as a class in this sheet; the real stamped
// band is `.rl-panel__band`, which `panel()` already builds.

import { panel } from './panel';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirm: string;
  /** Red band, red confirm button -- for an action that cannot be undone. */
  danger?: boolean;
}

/**
 * Is SOME modal -- a confirm or the pause menu (`ui/pause.ts`) -- currently
 * open?
 *
 * Task 6 fix round 1: `main.ts`'s battlefield keydown listener is the
 * OLDEST bubble listener on `window` (registered once at boot, long before
 * any dialog exists), so on a bare Escape it used to run before any
 * dialog's own Escape handler and act on its own idea of what Escape means
 * -- opening the pause menu under a confirm the HUD's own "Leave the
 * mission?" button had just opened, or (worse) resuming the game and
 * tearing the pause menu down while the player was only trying to cancel a
 * "Restart the mission?" confirm stacked on top of it. The fix is not
 * another capture-phase trick -- it is for the game's OWN handler to check
 * this before doing anything on Escape, so the open dialog (whichever one)
 * is always Escape's sole target and the game defers to it rather than
 * racing it. `.rl-pause` counts as a dialog here too: the pause menu's own
 * Resume/Escape handling is what closes IT, never the game.
 */
export function isDialogOpen(doc: Document = document): boolean {
  return doc.querySelector('.rl-confirm, .rl-pause') !== null;
}

/**
 * Mounts a modal confirm under `host` and resolves once the player answers.
 *
 * Cancel takes focus on mount, so an Enter that was meant for the game
 * underneath does not confirm. Escape cancels, and so does a click on the
 * scrim outside the panel. Either answer removes the dialog from the DOM
 * before resolving, so a caller never has to clean up after it -- and, since
 * this presents itself as a `role="dialog"` modal (the WAI-ARIA APG's own
 * expectation for the pattern, fix round 1), focus returns to whatever
 * opened it, captured here before `no.focus()` steals it. Removing the
 * focused element from the document would otherwise drop focus to `<body>`,
 * losing a keyboard player's position entirely.
 */
export function confirmDialog(host: HTMLElement, opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrim = document.createElement('div');
    scrim.className = 'rl-confirm';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');

    const p = panel({ rank: opts.danger ? 'alert' : 'inspect', title: opts.title });
    p.el.classList.add('rl-confirm__panel');

    const body = document.createElement('p');
    body.className = 'rl-confirm__body';
    body.textContent = opts.body;
    p.body.appendChild(body);

    const row = document.createElement('div');
    row.className = 'rl-confirm__row';
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'rl-btn rl-confirm__no';
    no.textContent = 'Cancel';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'rl-btn rl-confirm__yes';
    yes.textContent = opts.confirm;
    if (opts.danger) yes.dataset.danger = '1';
    row.append(no, yes);
    p.body.appendChild(row);

    const done = (v: boolean): void => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onCaptureKey, true);
      scrim.remove();
      opener?.focus();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done(false);
    };
    // I5: `role="dialog"`/`aria-modal="true"` above is a CLAIM that nothing
    // outside this dialog responds to the keyboard while it is open -- and
    // until this it was false. `main.ts`'s own `window.addEventListener(
    // 'keydown', ...)` issues game verbs ('h' halt, 'o' overlay toggle,
    // Ctrl/Cmd-A select-all, the group keys) with no modal guard at all, and
    // it is registered once at startup, long before any dialog exists, so a
    // later BUBBLE-phase listener from `onKey` above can never run before
    // it on the same target (`window`) -- registration order decides among
    // same-phase listeners, and main.ts's came first. A CAPTURE-phase
    // listener sidesteps that: capture always runs before bubble on the
    // same path, regardless of registration order, because the event has
    // not reached the target yet. `stopPropagation()` here therefore keeps
    // the keydown from ever reaching main.ts's bubble listener (or the
    // focused element's own listeners) at all -- the dialog most exercised
    // by this, "Leave the mission?" (`hud.ts`), is raised mid-fight, and a
    // player who types while it is open must not still be commanding units.
    // Escape/Enter/Tab/Shift+Tab pass through untouched: Escape is this
    // dialog's OWN cancel (`onKey` above, a bubble listener on the same
    // target -- stopping propagation for Escape too would block it from
    // ever reaching itself), Enter activates whichever button has focus,
    // and Tab/Shift+Tab (both carry `key === 'Tab'`) are the browser's
    // native focus movement, which nothing here traps (Minor 10 -- a
    // separate, already-recorded gap).
    const onCaptureKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') return;
      e.stopPropagation();
    };
    no.addEventListener('click', () => done(false));
    yes.addEventListener('click', () => done(true));
    // Outside the panel counts as Cancel; a click ON the panel -- its band,
    // its body text, either button -- must not fall through to this. The
    // panel takes pointer events for exactly that reason (theme.css).
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) done(false);
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onCaptureKey, true);

    scrim.appendChild(p.el);
    host.appendChild(scrim);
    no.focus();
  });
}
