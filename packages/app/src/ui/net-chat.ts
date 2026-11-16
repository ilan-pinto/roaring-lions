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
import type { ChatInbox } from './chat-inbox';

/** The room's own cap (`room-core.ts`'s `CHAT_MAX_CHARS`). */
export const CHAT_MAX_CHARS = 280;
/** Lines the docked log keeps; older ones are dropped. */
export const CHAT_LOG_LINES = 50;

export interface ChatDeps {
  send(text: string): void;
  nameOf(seat: Seat): string;
  /** GH-1417 S1: the room's inbox and the OTHER seat. With both, the chat shows a button that mutes that seat for the rest of the room,
   *  and when the inbox says chat is off the chat shows a line saying so and offers no input. The lines themselves reach `receive`
   *  only through the inbox (`chat-inbox.ts`); this class never decides what is shown. */
  inbox?: ChatInbox;
  peer?: Seat;
  /** GH-1417 S3: opens the report dialog for the OTHER seat. Absent (a build that does not send, or a spectator): no Report button.
   *  The button shows once that seat has said something, because a report needs something to point at. */
  report?: () => void;
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
  private readonly off: HTMLElement;
  private readonly muteBtn: HTMLButtonElement | null = null;
  /** GH-1417 S3: persistent block (a member only, by public id) and report (once the other seat has spoken). */
  private readonly blockBtn: HTMLButtonElement | null = null;
  private readonly reportBtn: HTMLButtonElement | null = null;
  private readonly unsub: (() => void) | null = null;

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
    this.off = document.createElement('p');
    this.off.className = 'rl-chat__off';
    this.off.textContent = t('net.chat.off');
    this.off.hidden = true;
    const { inbox, peer } = deps;
    if (inbox !== undefined && peer !== undefined) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rl-chat__mute';
      btn.addEventListener('click', () => {
        inbox.toggleMuted(peer);
      });
      this.muteBtn = this.wireAction(btn);
      this.entry.appendChild(btn);
      const block = document.createElement('button');
      block.type = 'button';
      block.className = 'rl-chat__block';
      block.addEventListener('click', () => {
        inbox.toggleBlocked(peer);
      });
      this.blockBtn = this.wireAction(block);
      this.entry.appendChild(block);
      if (deps.report !== undefined) {
        const rep = document.createElement('button');
        rep.type = 'button';
        rep.className = 'rl-chat__report';
        rep.addEventListener('click', () => {
          // In the match the chat closes first, so the modal owns the keys; the lobby's docked input keeps what was typed.
          if (!this.docked) this.close();
          deps.report?.();
        });
        this.reportBtn = this.wireAction(rep);
        this.entry.appendChild(rep);
      }
      this.unsub = inbox.onChange(() => this.paintMute());
      this.paintMute();
    }
    this.entry.hidden = !this.docked;
    this.root.append(this.off, this.log, this.entry);
    this.applyEnabled();
    this.input.addEventListener('keydown', this.onKey);
    if (!this.docked) this.input.addEventListener('blur', this.onBlur);
    parent.appendChild(this.root);
  }

  /** Whether the inbox lets chat show; true when this chat has no inbox. */
  private get on(): boolean {
    return this.deps.inbox?.isEnabled() ?? true;
  }

  /** Shows or hides the input, the log and the "chat is off" line to match the setting, read now. */
  private applyEnabled(): void {
    const on = this.on;
    this.off.hidden = on;
    this.log.hidden = !on;
    if (!on) this.entry.hidden = true;
    else if (this.docked) this.entry.hidden = false;
  }

  /** A button beside the input: it never takes focus from the input on a mouse press, keeps the game's keys out, and (in the match)
   *  closes the chat when focus leaves the row. */
  private wireAction(btn: HTMLButtonElement): HTMLButtonElement {
    // A click must not take focus from the input first: that blur would close the match's input before the click lands.
    btn.addEventListener('mousedown', (ev) => ev.preventDefault());
    btn.addEventListener('keydown', this.onMuteKey);
    if (!this.docked) btn.addEventListener('blur', this.onMuteBlur);
    return btn;
  }

  private get actions(): HTMLButtonElement[] {
    return [this.muteBtn, this.blockBtn, this.reportBtn].filter((b): b is HTMLButtonElement => b !== null);
  }

  private paintMute(): void {
    const { inbox, peer } = this.deps;
    if (this.muteBtn === null || inbox === undefined || peer === undefined) return;
    const name = this.deps.nameOf(peer);
    const muted = inbox.isMuted(peer);
    this.muteBtn.textContent = t(muted ? 'net.chat.unmute' : 'net.chat.mute', { name });
    this.muteBtn.setAttribute('aria-pressed', String(muted));
    if (this.blockBtn !== null) {
      // Only a member can be blocked (D5): a guest has no id to recognise next match, so a guest is muted, not blocked.
      const blocked = inbox.isBlocked(peer);
      this.blockBtn.hidden = !inbox.canBlock(peer);
      this.blockBtn.textContent = t(blocked ? 'net.chat.unblock' : 'net.chat.block', { name });
      this.blockBtn.setAttribute('aria-pressed', String(blocked));
    }
    if (this.reportBtn !== null) {
      this.reportBtn.hidden = !inbox.hasHeard(peer);
      this.reportBtn.textContent = t('net.chat.report', { name });
    }
  }

  /** True while the input is shown and has focus. */
  get isOpen(): boolean {
    return !this.entry.hidden && document.activeElement === this.input;
  }

  /** Shows the input and focuses it. */
  open(): void {
    this.applyEnabled();
    if (!this.on) return;
    this.entry.hidden = false;
    this.paintMute();
    this.input.focus();
  }

  /** Hides the input (the docked one stays) and gives the keys back to the game. */
  close(): void {
    this.input.value = '';
    if (!this.docked) this.entry.hidden = true;
    const active = document.activeElement;
    if (active === this.input || this.actions.some((b) => b === active)) (active as HTMLElement).blur();
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
    for (const b of this.actions) {
      b.removeEventListener('keydown', this.onMuteKey);
      b.removeEventListener('blur', this.onMuteBlur);
    }
    this.unsub?.();
    this.root.remove();
  }

  /** The mute button, like the input, keeps the game's keys out (it may hold focus while the match runs) and lets Escape close the chat. */
  private readonly onMuteKey = (ev: KeyboardEvent): void => {
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    }
  };

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

  /** Focus leaving the mute button for anywhere but the input closes the match's chat, as leaving the input does. */
  private readonly onMuteBlur = (ev: FocusEvent): void => {
    if (ev.relatedTarget === this.input || this.actions.some((b) => b === ev.relatedTarget)) return;
    if (!this.entry.hidden) this.close();
  };

  private readonly onBlur = (ev: FocusEvent): void => {
    // Focus moving to one of the row's buttons is still the chat.
    if (this.actions.some((b) => b === ev.relatedTarget)) return;
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
