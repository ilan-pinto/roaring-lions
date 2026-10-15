// packages/app/src/ui/net-chat.ts
/**
 * Text chat between the two seats of a room (N1b task 9): in the lobby, a
 * docked log and an input that is always there; in the match, an input that
 * Enter opens (`main.ts`'s keydown listener, rooms only -- no keymap action,
 * so single-player's Controls and F1 card are untouched) and whose incoming
 * lines go to the HUD feed through `chatFeedLine`.
 *
 * Everything here is typed by players: the text AND the callsign are
 * untrusted. The log builds its lines with `textContent` only, and
 * `chatFeedLine` -- the one path into the HUD feed, which sets `innerHTML` --
 * escapes both values before they meet the catalogue line.
 *
 * The room is the authority on what a line may be (trimmed, control
 * characters stripped, 280 characters, one line per seat per 500 ms) and it
 * echoes every line to both seats, the sender's own included: nothing is
 * drawn here until the room says it.
 *
 * While the input has focus the game's keys must not fire. Its keydown
 * listener stops propagation, so the battlefield's window listener never
 * sees a key typed here (it also returns early for any text field,
 * `isTextEntry`); keyup is left alone, so a pan key held across opening the
 * chat is still released.
 */
import type { Seat } from '@lions/net';
import { t } from '../i18n/t';
import { escapeHtml } from './escape-html';

/** The room's own cap (`room-core.ts`'s `CHAT_MAX_CHARS`). */
export const CHAT_MAX_CHARS = 280;
/** Lines the docked log keeps; older ones are dropped. */
export const CHAT_LOG_LINES = 50;

export interface ChatDeps {
  send(text: string): void;
  nameOf(seat: Seat): string;
}

export interface ChatOptions {
  /** The lobby's form: the input is always shown and stays after a send, and
   *  Escape only clears it. Without it (the match), the input is hidden until
   *  `open()`, and a send, Escape or a click away closes it again. */
  docked?: boolean;
}

export class NetChat {
  private readonly root: HTMLElement;
  private readonly log: HTMLOListElement;
  private readonly entry: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly docked: boolean;

  constructor(parent: HTMLElement, private readonly deps: ChatDeps, opts: ChatOptions = {}) {
    this.docked = opts.docked === true;
    this.root = document.createElement('div');
    this.root.className = this.docked ? 'rl-chat rl-chat--docked' : 'rl-chat rl-chat--float';
    this.log = document.createElement('ol');
    this.log.className = 'rl-chat__log';
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    this.entry = document.createElement('div');
    this.entry.className = 'rl-chat__entry';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'rl-chat__input';
    this.input.maxLength = CHAT_MAX_CHARS;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = t('net.chat.placeholder');
    this.input.setAttribute('aria-label', t('net.chat.placeholder'));
    this.entry.appendChild(this.input);
    this.entry.hidden = !this.docked;
    this.root.append(this.log, this.entry);
    this.input.addEventListener('keydown', this.onKey);
    if (!this.docked) this.input.addEventListener('blur', this.onBlur);
    parent.appendChild(this.root);
  }

  /** True while the input is shown and has focus. */
  get isOpen(): boolean {
    return !this.entry.hidden && document.activeElement === this.input;
  }

  /** Shows the input and focuses it. */
  open(): void {
    this.entry.hidden = false;
    this.input.focus();
  }

  /** Hides the input (the docked one stays) and gives the keys back to the game. */
  close(): void {
    this.input.value = '';
    if (!this.docked) this.entry.hidden = true;
    if (document.activeElement === this.input) this.input.blur();
  }

  /** Appends one line to this chat's own log (the lobby's). */
  receive(seat: Seat, text: string): void {
    const li = document.createElement('li');
    li.className = 'rl-chat__line';
    li.textContent = t('net.chat.line', { name: this.deps.nameOf(seat), text });
    this.log.appendChild(li);
    while (this.log.childElementCount > CHAT_LOG_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  dispose(): void {
    this.input.removeEventListener('keydown', this.onKey);
    this.input.removeEventListener('blur', this.onBlur);
    this.root.remove();
  }

  private readonly onKey = (ev: KeyboardEvent): void => {
    ev.stopPropagation();
    // An input method still composing owns its own Enter.
    if (ev.isComposing) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const text = this.input.value.trim();
      if (text !== '') this.deps.send(text);
      this.input.value = '';
      if (!this.docked) this.close();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    }
  };

  private readonly onBlur = (): void => {
    if (!this.entry.hidden) this.close();
  };
}

/** Whether a keydown on the battlefield opens the match's chat: a bare Enter,
 *  in a room only, with no dialog and no pause menu up. Not a keymap action
 *  (R-B12), so single-player's Controls list and F1 card never show it. */
export function chatOpens(
  ev: Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  ctx: { inRoom: boolean; modalOpen: boolean },
): boolean {
  return ctx.inRoom && !ctx.modalOpen && ev.key === 'Enter' && !ev.repeat && !ev.ctrlKey && !ev.metaKey && !ev.altKey;
}

/** What a battlefield keydown does about Enter in a room: open the chat or
 *  nothing. Extracted from `main.ts`'s listener so the decision is testable.
 *  Enter NEVER accepts an advisor's proposal (N4a, the coordinator's ruling: a
 *  player reaching for chat would accept by accident) -- accepting is the
 *  panel's Accept button or the 2 s deadline. `advisor` is taken, and never
 *  called, so a test can hand it a live `accept` and see it left alone. */
export function roomEnterAction(
  ev: Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  ctx: { inRoom: boolean; modalOpen: boolean },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see above: deliberately ignored
  _advisor: { accept(): boolean } | null,
): 'chat' | null {
  return chatOpens(ev, ctx) ? 'chat' : null;
}

/** One feed line for the battlefield's HUD, which sets `innerHTML`: both
 *  values escaped, then the catalogue's line. */
export function chatFeedLine(name: string, text: string): string {
  return t('net.chat.line', { name: escapeHtml(name), text: escapeHtml(text) });
}
