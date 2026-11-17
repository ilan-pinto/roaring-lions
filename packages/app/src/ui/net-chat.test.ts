// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Seat } from '@lions/net';
import { NetChat, chatFeedLine, chatOpens, roomEnterAction, type ChatDeps } from './net-chat';
import { ChatInbox } from './chat-inbox';
import { QUICK_CHAT_IDS, quickChatText } from './quick-chat';

const NAMES: Record<Seat, string> = { 0: 'A', 1: 'B' };

function mount(opts?: { docked?: boolean }) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const send = vi.fn<(text: string) => void>();
  const deps: ChatDeps = { send, nameOf: (seat) => NAMES[seat] };
  const chat = new NetChat(parent, deps, opts);
  const input = parent.querySelector<HTMLInputElement>('.rl-chat__input')!;
  return { parent, send, chat, input };
}

const key = (el: EventTarget, k: string): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('NetChat', () => {
  it('starts with its input hidden; open() shows it and focuses it, with the placeholder and the room\'s 280 cap', () => {
    const { input, chat } = mount();
    expect(input.closest<HTMLElement>('.rl-chat__entry')!.hidden).toBe(true);
    chat.open();
    expect(input.closest<HTMLElement>('.rl-chat__entry')!.hidden).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(input.placeholder).toBe('Say something (Enter to send)');
    expect(input.maxLength).toBe(280);
  });

  it('Enter in the input sends the trimmed text and clears it', () => {
    const { input, chat, send } = mount();
    chat.open();
    input.value = '   hello there  ';
    key(input, 'Enter');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('hello there');
    expect(input.value).toBe('');
  });

  it('an empty (or blank) input sends nothing', () => {
    const { input, chat, send } = mount();
    chat.open();
    input.value = '';
    key(input, 'Enter');
    chat.open();
    input.value = '    ';
    key(input, 'Enter');
    expect(send).not.toHaveBeenCalled();
  });

  it('Escape closes without sending', () => {
    const { input, chat, send } = mount();
    chat.open();
    input.value = 'not this';
    key(input, 'Escape');
    expect(send).not.toHaveBeenCalled();
    expect(input.closest<HTMLElement>('.rl-chat__entry')!.hidden).toBe(true);
    expect(input.value).toBe('');
    expect(document.activeElement).not.toBe(input);
  });

  it('keys typed into the input never reach the game\'s window listener', () => {
    const { input, chat } = mount();
    const game = vi.fn();
    window.addEventListener('keydown', game);
    try {
      chat.open();
      for (const k of ['h', 'w', 'Escape', 'Enter', '1']) key(input, k);
      expect(game).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', game);
    }
  });

  it('receive(1, \'<b>x</b>\') adds a line that reads "B: <b>x</b>" as TEXT, with no <b> element', () => {
    const { parent, chat } = mount();
    chat.receive(1, '<b>x</b>');
    const lines = parent.querySelectorAll('.rl-chat__line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe('B: <b>x</b>');
    expect(parent.querySelector('b')).toBeNull();
  });

  it('a hostile callsign is text too', () => {
    const parent = document.createElement('div');
    const chat = new NetChat(parent, { send: () => {}, nameOf: () => '<img src=x onerror=alert(1)>' });
    chat.receive(0, 'hi');
    expect(parent.querySelector('img')).toBeNull();
    expect(parent.querySelector('.rl-chat__line')!.textContent).toBe('<img src=x onerror=alert(1)>: hi');
  });

  it('keeps the last 50 lines', () => {
    const { parent, chat } = mount();
    for (let i = 0; i < 60; i++) chat.receive(0, `m${i}`);
    const lines = [...parent.querySelectorAll('.rl-chat__line')].map((l) => l.textContent);
    expect(lines).toHaveLength(50);
    expect(lines[0]).toBe('A: m10');
    expect(lines.at(-1)).toBe('A: m59');
  });

  it('docked (the lobby): the input is always shown, Enter sends and the field stays', () => {
    const { input, chat, send } = mount({ docked: true });
    const entry = input.closest<HTMLElement>('.rl-chat__entry')!;
    expect(entry.hidden).toBe(false);
    input.focus();
    input.value = 'ready?';
    key(input, 'Enter');
    expect(send).toHaveBeenCalledWith('ready?');
    expect(entry.hidden).toBe(false);
    key(input, 'Escape');
    expect(entry.hidden).toBe(false);
    chat.dispose();
  });

  it('dispose removes everything it mounted', () => {
    const { parent, chat } = mount();
    chat.dispose();
    expect(parent.childElementCount).toBe(0);
  });
});

describe('chatFeedLine (the battlefield\'s HUD line, which goes to innerHTML)', () => {
  it('escapes both the name and the text: no "<" survives that is not "&lt;"', () => {
    const line = chatFeedLine('<i>', '<img src=x>');
    expect(line.replace(/&lt;/g, '')).not.toContain('<');
    expect(line).toBe('&lt;i&gt;: &lt;img src=x&gt;');
  });

  it('renders as the plain text when set as innerHTML', () => {
    const el = document.createElement('div');
    el.innerHTML = chatFeedLine('Bo "the" \'Lion\' & co', '<script>alert(1)</script>');
    expect(el.childElementCount).toBe(0);
    expect(el.textContent).toBe('Bo "the" \'Lion\' & co: <script>alert(1)</script>');
  });
});

describe('chatOpens (the battlefield\'s Enter, R-B12: no keymap action)', () => {
  const enter = { key: 'Enter', repeat: false, ctrlKey: false, metaKey: false, altKey: false };
  const free = { inRoom: true, modalOpen: false };
  it('Enter in a room with nothing open opens the chat', () => {
    expect(chatOpens(enter, free)).toBe(true);
  });
  it('never in single-player', () => {
    expect(chatOpens(enter, { inRoom: false, modalOpen: false })).toBe(false);
  });
  it('never over a dialog or the pause menu', () => {
    expect(chatOpens(enter, { inRoom: true, modalOpen: true })).toBe(false);
  });
  it('not on a held repeat, a modified Enter, or any other key', () => {
    expect(chatOpens({ ...enter, repeat: true }, free)).toBe(false);
    expect(chatOpens({ ...enter, ctrlKey: true }, free)).toBe(false);
    expect(chatOpens({ ...enter, metaKey: true }, free)).toBe(false);
    expect(chatOpens({ ...enter, altKey: true }, free)).toBe(false);
    expect(chatOpens({ ...enter, key: 'h' }, free)).toBe(false);
  });
});

describe('roomEnterAction (Enter never accepts an advisor proposal)', () => {
  const enter = { key: 'Enter', repeat: false, ctrlKey: false, metaKey: false, altKey: false };
  const free = { inRoom: true, modalOpen: false };
  it('with a proposal showing, Enter does not call accept and still opens the chat', () => {
    const accept = vi.fn(() => true);
    expect(roomEnterAction(enter, free, { accept })).toBe('chat');
    expect(accept).not.toHaveBeenCalled();
  });
  it('with no advisor, or nothing showing, Enter opens the chat', () => {
    expect(roomEnterAction(enter, free, null)).toBe('chat');
    expect(roomEnterAction(enter, free, { accept: () => false })).toBe('chat');
  });
  it('over a dialog, in single-player, or on another key, nothing', () => {
    const accept = vi.fn(() => true);
    expect(roomEnterAction(enter, { inRoom: true, modalOpen: true }, { accept })).toBeNull();
    expect(roomEnterAction(enter, { inRoom: false, modalOpen: false }, { accept })).toBeNull();
    expect(roomEnterAction({ ...enter, key: 'x' }, free, { accept })).toBeNull();
    expect(accept).not.toHaveBeenCalled();
  });
});

// GH-1417 S1: the mute button and the chat-off state. The lines themselves come through the inbox (`chat-inbox.test.ts`).
describe('NetChat with an inbox', () => {
  function mountWithInbox(opts?: { docked?: boolean }, enabled: { on: boolean } = { on: true }) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const inbox = new ChatInbox(() => enabled.on);
    const deps: ChatDeps = { send: vi.fn(), nameOf: (seat) => NAMES[seat], inbox, peer: 1 };
    const chat = new NetChat(parent, deps, opts);
    const q = <T extends HTMLElement>(sel: string): T => parent.querySelector<T>(sel)!;
    return { parent, inbox, chat, q, enabled };
  }

  it('shows a mute button naming the other seat, and a click toggles the inbox, the label and aria-pressed', () => {
    const { inbox, q } = mountWithInbox({ docked: true });
    const btn = q<HTMLButtonElement>('.rl-chat__mute');
    expect(btn.textContent).toBe('Mute B');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.type).toBe('button');
    btn.click();
    expect(inbox.isMuted(1)).toBe(true);
    expect(inbox.isMuted(0)).toBe(false);
    expect(btn.textContent).toBe('Unmute B');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    btn.click();
    expect(inbox.isMuted(1)).toBe(false);
    expect(btn.textContent).toBe('Mute B');
  });

  it('repaints the label when the mute changes elsewhere (the lobby\'s mute seen in the match chat)', () => {
    const { inbox, q } = mountWithInbox({ docked: true });
    inbox.setMuted(1, true);
    expect(q('.rl-chat__mute').textContent).toBe('Unmute B');
  });

  it('has no mute button without an inbox and a peer', () => {
    const { parent } = mount({ docked: true });
    expect(parent.querySelector('.rl-chat__mute')).toBeNull();
  });

  it('in the match, focus moving from the input to the mute button keeps the chat open; focus going anywhere else closes it', () => {
    const { q, chat } = mountWithInbox();
    const entry = q('.rl-chat__entry');
    const input = q<HTMLInputElement>('.rl-chat__input');
    const btn = q<HTMLButtonElement>('.rl-chat__mute');
    chat.open();
    input.dispatchEvent(new FocusEvent('blur', { relatedTarget: btn }));
    expect(entry.hidden).toBe(false);
    btn.dispatchEvent(new FocusEvent('blur', { relatedTarget: input }));
    expect(entry.hidden).toBe(false);
    btn.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
    expect(entry.hidden).toBe(true);
    chat.open();
    input.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
    expect(entry.hidden).toBe(true);
  });

  it('a mousedown on the button is default-prevented, so the click cannot first blur the input shut', () => {
    const { q } = mountWithInbox();
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    q('.rl-chat__mute').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('keys typed on the button never reach the game, and Escape closes the match chat', () => {
    const { q, chat } = mountWithInbox();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    chat.open();
    const btn = q<HTMLButtonElement>('.rl-chat__mute');
    key(btn, 'w');
    expect(seen).not.toHaveBeenCalled();
    const esc = key(btn, 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(q('.rl-chat__entry').hidden).toBe(true);
    window.removeEventListener('keydown', seen);
  });

  it('chat off: the lobby shows the line that says so and no input, and the match\'s open() does nothing', () => {
    const lobby = mountWithInbox({ docked: true }, { on: false });
    expect(lobby.q('.rl-chat__off').hidden).toBe(false);
    expect(lobby.q('.rl-chat__off').textContent).toBe('Chat is off. Turn it on in Settings.');
    expect(lobby.q('.rl-chat__entry').hidden).toBe(true);
    expect(lobby.q('.rl-chat__log').hidden).toBe(true);
    document.body.replaceChildren();
    const match = mountWithInbox(undefined, { on: false });
    match.chat.open();
    expect(match.q('.rl-chat__entry').hidden).toBe(true);
    expect(match.chat.isOpen).toBe(false);
    // turned back on over a running match: the next open works and the line goes
    match.enabled.on = true;
    match.chat.open();
    expect(match.q('.rl-chat__entry').hidden).toBe(false);
    expect(match.q('.rl-chat__off').hidden).toBe(true);
    expect(match.q('.rl-chat__log').hidden).toBe(false);
  });

  it('chat on: no off line, the log shows, and the docked input is there', () => {
    const { q } = mountWithInbox({ docked: true });
    expect(q('.rl-chat__off').hidden).toBe(true);
    expect(q('.rl-chat__log').hidden).toBe(false);
    expect(q('.rl-chat__entry').hidden).toBe(false);
  });

  it('dispose releases the inbox subscription and the button\'s listeners', () => {
    const inbox = new ChatInbox(() => true);
    const unsub = vi.fn();
    vi.spyOn(inbox, 'onChange').mockReturnValue(unsub);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const chat = new NetChat(parent, { send: vi.fn(), nameOf: (seat) => NAMES[seat], inbox, peer: 1 });
    chat.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(parent.querySelector('.rl-chat')).toBeNull();
  });
});

// GH-1417 S1b: the quick-chat menu. It sends an id, never text.
describe('NetChat quick chat', () => {
  function mountQuick(opts?: { docked?: boolean }) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const inbox = new ChatInbox(() => true);
    const sendQuick = vi.fn<(id: string) => void>();
    const send = vi.fn<(text: string) => void>();
    const chat = new NetChat(parent, { send, sendQuick, nameOf: (seat) => NAMES[seat], inbox, peer: 1 }, opts);
    const sel = parent.querySelector<HTMLSelectElement>('.rl-chat__quick')!;
    const pick = (value: string): void => {
      sel.value = value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    return { parent, chat, sel, send, sendQuick, pick };
  }

  it('is a labelled select: a prompt and the twelve phrases in the catalogue\'s words, and only when sendQuick is given', () => {
    const { sel } = mountQuick({ docked: true });
    expect(sel.getAttribute('aria-label')).toBe('Quick chat');
    const opts = [...sel.options];
    expect(opts[0].value).toBe('');
    expect(opts[0].textContent).toBe('Say a phrase...');
    expect(opts.slice(1).map((o) => o.value)).toEqual([...QUICK_CHAT_IDS]);
    expect(opts.slice(1).map((o) => o.textContent)).toEqual(QUICK_CHAT_IDS.map((id) => quickChatText(id)));
    expect(opts.slice(1).map((o) => o.textContent)).toContain('Good game.');
    const plain = mount({ docked: true });
    expect(plain.parent.querySelector('.rl-chat__quick')).toBeNull();
  });

  it('choosing a phrase sends its ID through sendQuick, never text through send, and the menu goes back to its prompt', () => {
    const { sel, pick, sendQuick, send } = mountQuick({ docked: true });
    pick('wp');
    expect(sendQuick).toHaveBeenCalledTimes(1);
    expect(sendQuick).toHaveBeenCalledWith('wp');
    expect(send).not.toHaveBeenCalled();
    expect(sel.value).toBe('');
  });

  it('ignores the prompt and a value that is not a phrase id', () => {
    const { pick, sendQuick } = mountQuick({ docked: true });
    pick('');
    pick('not-a-phrase');
    expect(sendQuick).not.toHaveBeenCalled();
  });

  it('in the match, a choice closes the chat, as a send does; the lobby\'s docked chat stays', () => {
    const match = mountQuick();
    match.chat.open();
    const entry = match.parent.querySelector<HTMLElement>('.rl-chat__entry')!;
    expect(entry.hidden).toBe(false);
    match.pick('gl');
    expect(entry.hidden).toBe(true);
    const lobby = mountQuick({ docked: true });
    lobby.pick('gl');
    expect(lobby.parent.querySelector<HTMLElement>('.rl-chat__entry')!.hidden).toBe(false);
  });

  it('in the match, focus moving between the input, the mute button and the menu keeps the chat open; focus leaving the row closes it', () => {
    const { parent, chat, sel } = mountQuick();
    const entry = parent.querySelector<HTMLElement>('.rl-chat__entry')!;
    const input = parent.querySelector<HTMLInputElement>('.rl-chat__input')!;
    const btn = parent.querySelector<HTMLButtonElement>('.rl-chat__mute')!;
    chat.open();
    input.dispatchEvent(new FocusEvent('blur', { relatedTarget: sel }));
    expect(entry.hidden).toBe(false);
    sel.dispatchEvent(new FocusEvent('blur', { relatedTarget: btn }));
    expect(entry.hidden).toBe(false);
    sel.dispatchEvent(new FocusEvent('blur', { relatedTarget: input }));
    expect(entry.hidden).toBe(false);
    sel.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
    expect(entry.hidden).toBe(true);
  });

  it('keys typed on the menu never reach the game, and Escape closes the match chat', () => {
    const { chat, sel, parent } = mountQuick();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    chat.open();
    key(sel, 'a');
    expect(seen).not.toHaveBeenCalled();
    const esc = key(sel, 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(parent.querySelector<HTMLElement>('.rl-chat__entry')!.hidden).toBe(true);
    window.removeEventListener('keydown', seen);
  });

  it('is hidden with the rest of the input while chat is off', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const inbox = new ChatInbox(() => false);
    const chat = new NetChat(parent, { send: vi.fn(), sendQuick: vi.fn(), nameOf: (seat) => NAMES[seat], inbox, peer: 1 }, { docked: true });
    expect(parent.querySelector<HTMLElement>('.rl-chat__entry')!.hidden).toBe(true);
    chat.open();
    expect(parent.querySelector<HTMLElement>('.rl-chat__entry')!.hidden).toBe(true);
  });

  it('dispose releases the menu\'s listeners (a change after dispose sends nothing)', () => {
    const { chat, sel, pick, sendQuick } = mountQuick({ docked: true });
    chat.dispose();
    pick('gg');
    expect(sel.isConnected).toBe(false);
    expect(sendQuick).not.toHaveBeenCalled();
  });
});
