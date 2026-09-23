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

import { t } from '../i18n/t';
import { focusTrap } from './focus-trap';
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
 *
 * Task 8 fix round 1: `.rl-keys` (F1's key-bindings overlay) joined the
 * selector for the identical reason `.rl-pause` did. Before this, the
 * overlay had only a bubble-phase `keydown` listener of its own, so on a
 * bare Escape `main.ts`'s handler -- the oldest bubble listener on
 * `window`, per the paragraph above -- ran first, read this function as
 * `false`, and opened the pause menu in the same tick the overlay's own
 * listener closed the card: one key, two things. `keys-overlay.ts` now
 * installs a capture-phase guard of its own, mirroring `pause.ts`'s
 * `onCaptureKey`; this function's job is only to keep `main.ts`'s
 * handler-wide guard refusing `pause` AND `keysOverlay` while the card is
 * open, the same way it already refuses everything else.
 *
 * Task 5: `.rl-outcome` (the held victory/defeat moment, `ui/outcome-
 * moment.ts`) joined the selector for the identical reason `.rl-keys` did.
 * Its own capture-phase guard already `stopPropagation()`s every OTHER key
 * before it ever reaches `main.ts`, but `Tab` is deliberately left alone
 * there -- moving focus inside the trap is `focusTrap`'s job, not that
 * guard's, the same carve-out this file's own `onCaptureKey` makes below --
 * so a `Tab` press still bubbles all the way back to `main.ts`'s
 * handler-wide guard (`isDialogOpen() && !passesThroughModal(action)`,
 * `main.ts:3252`, which names itself "a second line of defence" for exactly
 * this: a key a modal passes through on purpose). That guard has to know
 * this moment counts as a dialog too, or a `Tab` reaching it while the
 * outcome moment is up would fall through to whatever `main.ts` binds it to.
 */
export function isDialogOpen(doc: Document = document): boolean {
  return doc.querySelector('.rl-confirm, .rl-pause, .rl-keys, .rl-outcome') !== null;
}

/** What `confirmDialog` hands back: the player's answer, and a way to take the
 *  question away again. */
export interface ConfirmHandle {
  /** True on confirm, false on cancel -- and false if the dialog was closed out
   *  from under the player by `closeOpenDialog()`, so a `.then` that acts only
   *  on `true` needs no extra guard. */
  answer: Promise<boolean>;
  /** Cancel and tear down: both `window` listeners off, scrim out of the DOM,
   *  `answer` settled false. Idempotent, and a no-op once answered. */
  close(): void;
}

/**
 * The one dialog that can be open (`isDialogOpen` above has always assumed
 * this), as a cancel function rather than as a DOM node -- because the DOM node
 * is exactly what goes missing.
 *
 * C1 (final review): a confirm registers two `window` keydown listeners and
 * took them off only from `done()`, which runs only when the player ANSWERS.
 * Nothing could cancel one. `Router.unmount()` calls the screen's disposer and
 * then `stage.replaceChildren()` -- and a screen's disposer is `() => wrap
 * .remove()`, which knows nothing about a scrim `confirmDialog` appended to the
 * STAGE as `wrap`'s sibling. So navigating away from an open confirm (browser
 * Back out of `/saves` mid-Delete, two clicks from a cold boot) stripped the
 * dialog from the document with `done()` never called, leaving its
 * CAPTURE-phase guard on `window` for the life of the page. That guard
 * `stopPropagation()`s every key that is not Escape/Enter/Tab, so every game
 * verb -- halt, smoke, overlay, load/unload, mute, select-all, the control
 * groups, all four pan keys -- was silently dead from then on, on every mission
 * booted afterwards, with nothing on screen to explain it and only a reload to
 * clear it.
 *
 * This is a cancel function and not a node so that `closeOpenDialog()` still
 * works after the node is gone, which is the only case that matters.
 */
let openCancel: (() => void) | null = null;

/**
 * Cancel whatever confirm is open, if any.
 *
 * Called by the two places that can destroy a dialog's host without the dialog
 * knowing: `Router.unmount()` (the stage is about to be emptied) and
 * `bootBattlefield`'s teardown (the HUD's leave confirm and the pause menu's
 * Restart/Quit confirms mount on `document.body`, which the router never
 * touches). Both are idempotent and either may run first.
 */
export function closeOpenDialog(): void {
  openCancel?.();
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
 *
 * Returns a handle rather than a bare promise (C1): whoever owns the HOST owns
 * the dialog's lifetime, and until this there was no way to say so. Callers
 * that only want the answer read `.answer`; nobody has to call `.close()` by
 * hand, because `Router.unmount` and `bootBattlefield`'s teardown both go
 * through `closeOpenDialog()` above.
 */
export function confirmDialog(host: HTMLElement, opts: ConfirmOptions): ConfirmHandle {
  // Assigned synchronously inside the executor below, before this function
  // returns -- a Promise executor runs immediately, so the handle never escapes
  // holding the placeholder.
  let cancel: () => void = () => {};
  const answer = new Promise<boolean>((resolve) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrim = document.createElement('div');
    scrim.className = 'rl-confirm';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');

    const p = panel({ rank: opts.danger ? 'alert' : 'inspect', title: opts.title });
    p.el.classList.add('rl-confirm__panel');
    // Installed here, right after `opener` is captured above and before the
    // body/buttons are appended: it queries `p.el` for its own focusable
    // descendants at KEYPRESS time, not now, so the two buttons appended
    // below are covered with no ordering requirement on this line at all.
    const disposeTrap = focusTrap(p.el);

    const body = document.createElement('p');
    body.className = 'rl-confirm__body';
    body.textContent = opts.body;
    p.body.appendChild(body);

    const row = document.createElement('div');
    row.className = 'rl-confirm__row';
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'rl-btn rl-confirm__no';
    no.textContent = t('confirm.cancel');
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'rl-btn rl-confirm__yes';
    yes.textContent = opts.confirm;
    if (opts.danger) yes.dataset.danger = '1';
    row.append(no, yes);
    p.body.appendChild(row);

    // Idempotent, and it has to be: `close()` may arrive after the player has
    // already clicked an answer (a navigation triggered by the answer itself
    // unmounts the screen), and both `Router.unmount` and the battlefield
    // teardown can call `closeOpenDialog()` for the same dialog.
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      // Only clear the module slot if it still points at THIS dialog -- a
      // second confirm opened over the first owns the slot from then on.
      if (openCancel === cancel) openCancel = null;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onCaptureKey, true);
      disposeTrap();
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
    // and Tab/Shift+Tab (both carry `key === 'Tab'`) are `focusTrap`'s job
    // now (installed above, right after the panel is built), not this
    // guard's -- it only cycles focus within the panel and does nothing
    // else, so this guard has nothing left to add.
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

    cancel = () => done(false);

    scrim.appendChild(p.el);
    host.appendChild(scrim);
    no.focus();
  });
  openCancel = cancel;
  return { answer, close: cancel };
}
