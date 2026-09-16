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
      scrim.remove();
      opener?.focus();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done(false);
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

    scrim.appendChild(p.el);
    host.appendChild(scrim);
    no.focus();
  });
}
