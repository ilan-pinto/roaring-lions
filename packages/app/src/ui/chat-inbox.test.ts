// GH-1417 S1: the one door a received chat line goes through.
import { describe, expect, it, vi } from 'vitest';
import { ChatInbox, inboxOf } from './chat-inbox';
import { compileFilter } from './chat-filter';

const lines = (inbox: ChatInbox, feed: [0 | 1, string][]): string[] => {
  const shown: string[] = [];
  for (const [seat, text] of feed) inbox.deliver(seat, text, (t) => shown.push(`${seat}:${t}`));
  return shown;
};

describe('ChatInbox', () => {
  it('shows every line while chat is on and nothing is muted', () => {
    expect(lines(new ChatInbox(() => true), [[0, 'a'], [1, 'b']])).toEqual(['0:a', '1:b']);
  });

  it('hides a muted seat and only that seat, and shows it again after an unmute', () => {
    const inbox = new ChatInbox(() => true);
    inbox.setMuted(1, true);
    expect(lines(inbox, [[0, 'mine'], [1, 'theirs'], [0, 'mine 2']])).toEqual(['0:mine', '0:mine 2']);
    expect(inbox.isMuted(1)).toBe(true);
    expect(inbox.isMuted(0)).toBe(false);
    inbox.setMuted(1, false);
    expect(lines(inbox, [[1, 'back']])).toEqual(['1:back']);
  });

  it('chat off hides every line, the sender\'s own echo included, and reads the setting at each line', () => {
    let on = true;
    const inbox = new ChatInbox(() => on);
    expect(lines(inbox, [[0, 'x']])).toEqual(['0:x']);
    on = false;
    expect(lines(inbox, [[0, 'x'], [1, 'y']])).toEqual([]);
    expect(inbox.verdict(1)).toBe('off');
    on = true;
    expect(lines(inbox, [[1, 'y']])).toEqual(['1:y']);
  });

  it('off wins over muted in the verdict, and a mute made while chat is off holds when it comes back on', () => {
    let on = false;
    const inbox = new ChatInbox(() => on);
    inbox.setMuted(1, true);
    expect(inbox.verdict(1)).toBe('off');
    on = true;
    expect(inbox.verdict(1)).toBe('muted');
  });

  it('notifies a listener on a real change only, and the unsubscribe stops it', () => {
    const inbox = new ChatInbox(() => true);
    const fn = vi.fn();
    const off = inbox.onChange(fn);
    inbox.setMuted(1, true);
    inbox.setMuted(1, true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(inbox.toggleMuted(1)).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    inbox.setMuted(1, true);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('inboxOf', () => {
  it('gives the lobby and the match the SAME inbox for one transport, so a mute carries over, and another transport its own', () => {
    const transport = {};
    const lobby = inboxOf(transport, () => true);
    lobby.setMuted(1, true);
    const match = inboxOf(transport, () => true);
    expect(match).toBe(lobby);
    expect(match.isMuted(1)).toBe(true);
    expect(inboxOf({}, () => true).isMuted(1)).toBe(false);
  });

  it('takes the latest settings source: the battlefield\'s replaces the lobby\'s', () => {
    const transport = {};
    const inbox = inboxOf(transport, () => true);
    expect(inbox.isEnabled()).toBe(true);
    inboxOf(transport, () => false);
    expect(inbox.isEnabled()).toBe(false);
  });
});

describe('ChatInbox and the word filter (GH-1417 S2)', () => {
  // Invented words, so the oracle is the literal fixture and not the shipped list.
  const fixture = compileFilter([{ lang: 'en', hide: ['zorgon'], mask: ['blarg'], allow: [] }], () => true);

  it('hides a hide-word line from every sink, masks a mask word, and passes a clean line untouched', () => {
    const inbox = new ChatInbox(() => true, () => true, () => fixture);
    expect(lines(inbox, [[1, 'you zorgon'], [1, 'you blarg'], [0, 'gg']])).toEqual(['1:you ***', '0:gg']);
  });

  it('mask off shows the mask word as typed, and NEVER the hide word; the setting is read at every line', () => {
    let mask = true;
    const inbox = new ChatInbox(() => true, () => mask, () => fixture);
    expect(lines(inbox, [[1, 'blarg']])).toEqual(['1:***']);
    mask = false;
    expect(lines(inbox, [[1, 'blarg'], [1, 'zorgon'], [1, 'Z O R G O N']])).toEqual(['1:blarg']);
  });

  it('the filter runs after chat-off and mute: a muted seat\'s clean line stays hidden', () => {
    const inbox = new ChatInbox(() => true, () => true, () => fixture);
    inbox.setMuted(1, true);
    expect(lines(inbox, [[1, 'gg']])).toEqual([]);
  });

  it('refuses (the input\'s nudge) only a line the filter would hide, mask setting or not', () => {
    const inbox = new ChatInbox(() => true, () => false, () => fixture);
    expect(inbox.refuses('ok zorgon')).toBe(true);
    expect(inbox.refuses('ok blarg')).toBe(false);
    expect(inbox.refuses('ok')).toBe(false);
  });

  it('inboxOf carries the mask source, and the battlefield\'s replaces the lobby\'s', () => {
    const transport = {};
    const inbox = inboxOf(transport, () => true, () => true);
    expect(lines(inbox, [[1, 'well shit']])).toEqual(['1:well ***']);
    inboxOf(transport, () => true, () => false);
    expect(lines(inbox, [[1, 'well shit']])).toEqual(['1:well shit']);
  });

  it('with no filter handed in, the shipped English list applies', () => {
    const inbox = new ChatInbox(() => true);
    expect(lines(inbox, [[1, 'oh shit'], [1, 'hold the parapet']])).toEqual(['1:oh ***', '1:hold the parapet']);
  });
});

