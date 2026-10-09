// packages/app/src/shell/escape-back.ts
/**
 * Escape is the screen's back control (KS-07, `docs/polish/keyboard-and-saves.md`).
 *
 * The keyboard walk found Escape doing nothing on Brigade, Saves, Settings,
 * Credits, Free Play and the campaign board. The only way back was tabbing to
 * the back link at the end of the page. Every one of those screens builds its
 * way back with `footBack` (`ui/foot.ts`, GH-498), which tags it
 * `data-kind="back"`, so Escape now presses THAT control. Escape owns no
 * destination of its own: the screen decides where back goes, exactly as it
 * does for a click, and a screen with no back control gets nothing.
 *
 * Never:
 * - on the menu itself (it has nowhere to go back to), on a mission or a
 *   sandbox (the battlefield's Escape opens the pause menu), or on any route
 *   not named in `ESCAPE_BACK_ROUTES`;
 * - while a dialog owns Escape (`isDialogOpen()`), or when another listener
 *   has already spent the key (`defaultPrevented`): a key capture in
 *   Controls, for one, stops it before it gets here;
 * - from a text field, where Escape is the field's own key and leaving the
 *   screen would throw away what was typed;
 * - on an autorepeat. A held Escape is not a decision, and on a screen whose
 *   back lands on another back-capable screen it would walk the player
 *   several screens back.
 */
import type { Disposer } from './router';

/** The router names (`main.ts`'s route table) where Escape goes back. */
export const ESCAPE_BACK_ROUTES: ReadonlySet<string> = new Set(['campaign', 'brigade', 'free-play', 'settings', 'saves', 'credits']);

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/** The control Escape should press for this keydown, or null for "leave the key alone". */
export function escapeBackTarget(
  ev: KeyboardEvent,
  ctx: { route: string | null; stage: HTMLElement; dialogOpen: boolean }
): HTMLElement | null {
  if (ev.key !== 'Escape' || ev.repeat || ev.defaultPrevented || ctx.dialogOpen) return null;
  if (ctx.route === null || !ESCAPE_BACK_ROUTES.has(ctx.route)) return null;
  if (isTextEntry(ev.target)) return null;
  return ctx.stage.querySelector<HTMLElement>('[data-kind="back"]');
}

/** One bubble-phase `window` listener for the life of the document. The
 *  pressed control is clicked, so it goes through `interceptLinks` like any
 *  other link and the router makes the move. */
export function installEscapeBack(deps: { route(): string | null; stage: HTMLElement; dialogOpen(): boolean }): Disposer {
  const onKey = (ev: KeyboardEvent): void => {
    const target = escapeBackTarget(ev, { route: deps.route(), stage: deps.stage, dialogOpen: deps.dialogOpen() });
    if (!target) return;
    ev.preventDefault();
    target.click();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
