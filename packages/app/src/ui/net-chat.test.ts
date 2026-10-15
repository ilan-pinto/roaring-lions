// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Seat } from '@lions/net';
import { NetChat, chatFeedLine, chatOpens, roomEnterAction, type ChatDeps } from './net-chat';

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
