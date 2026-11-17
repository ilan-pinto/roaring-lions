// GH-1417 S1: the one door a received chat line goes through.
import { describe, expect, it, vi } from 'vitest';
import { createBlockList } from '../chat/block-list';
import { ChatInbox, inboxOf, type InboxWho } from './chat-inbox';

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

// GH-1417 S3: the persistent block (members, by public id), per-match mute for guests, and the reporter's copy.
const MEMBER = 'ABCDEFG1';
const store = () => {
  const d: Record<string, string> = {};
  return { getItem: (k: string) => d[k] ?? null, setItem: (k: string, v: string) => void (d[k] = v) };
};
const whoWith = (ids: [string | null, string | null], blocks = createBlockList(store())): InboxWho => ({ blocks, publicIdOf: (seat) => ids[seat] });

describe('ChatInbox block (D5)', () => {
  it('hides a blocked member and only that member, and shows them again after an unblock', () => {
    const inbox = new ChatInbox(() => true);
    inbox.useWho(whoWith([null, MEMBER]));
    expect(inbox.setBlocked(1, true)).toBe(true);
    expect(inbox.verdict(1)).toBe('blocked');
    expect(lines(inbox, [[0, 'mine'], [1, 'theirs']])).toEqual(['0:mine']);
    inbox.setBlocked(1, false);
    expect(lines(inbox, [[1, 'back']])).toEqual(['1:back']);
  });

  it('a guest cannot be blocked: no id, nothing stored, and the block control has nothing to do (the guest is muted instead)', () => {
    const s = store();
    const blocks = createBlockList(s);
    const inbox = new ChatInbox(() => true);
    inbox.useWho(whoWith([null, null], blocks));
    expect(inbox.canBlock(1)).toBe(false);
    expect(inbox.setBlocked(1, true)).toBe(false);
    expect(blocks.all()).toEqual([]);
    expect(lines(inbox, [[1, 'hi']])).toEqual(['1:hi']);
    inbox.setMuted(1, true);
    expect(lines(inbox, [[1, 'hi']])).toEqual([]);
  });

  it('a block outlives the room: a NEW inbox (a later match) on the same list still hides the member', () => {
    const blocks = createBlockList(store());
    const first = new ChatInbox(() => true);
    first.useWho(whoWith([null, MEMBER], blocks));
    first.setBlocked(1, true);
    const later = new ChatInbox(() => true);
    later.useWho(whoWith([null, MEMBER], blocks));
    expect(later.verdict(1)).toBe('blocked');
    // while the SAME member in the OTHER seat is recognised too: the block is the person, not the seat
    const swapped = new ChatInbox(() => true);
    swapped.useWho(whoWith([MEMBER, null], blocks));
    expect(swapped.verdict(0)).toBe('blocked');
    expect(swapped.verdict(1)).toBe('show');
  });

  it('off wins over blocked in the verdict, and blocked wins over muted', () => {
    let on = false;
    const inbox = new ChatInbox(() => on);
    inbox.useWho(whoWith([null, MEMBER]));
    inbox.setBlocked(1, true);
    inbox.setMuted(1, true);
    expect(inbox.verdict(1)).toBe('off');
    on = true;
    expect(inbox.verdict(1)).toBe('blocked');
  });

  it('a change to the block list made elsewhere reaches this inbox\'s listeners', () => {
    const blocks = createBlockList(store());
    const inbox = new ChatInbox(() => true);
    inbox.useWho(whoWith([null, MEMBER], blocks));
    const fn = vi.fn();
    inbox.onChange(fn);
    blocks.add(MEMBER);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(inbox.isBlocked(1)).toBe(true);
  });

  it('replacing the identity source does not leave a listener on the old list', () => {
    const a = createBlockList(store());
    const b = createBlockList(store());
    const inbox = new ChatInbox(() => true);
    inbox.useWho(whoWith([null, MEMBER], a));
    inbox.useWho(whoWith([null, MEMBER], b));
    const fn = vi.fn();
    inbox.onChange(fn);
    a.add(MEMBER);
    expect(fn).not.toHaveBeenCalled();
    b.add(MEMBER);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('inboxOf wires the identity once and keeps it across the lobby-to-match handover', () => {
    const transport = {};
    const blocks = createBlockList(store());
    const lobby = inboxOf(transport, () => true, { who: whoWith([null, MEMBER], blocks) });
    lobby.setBlocked(1, true);
    const match = inboxOf(transport, () => true);
    expect(match).toBe(lobby);
    expect(match.isBlocked(1)).toBe(true);
  });
});

describe('ChatInbox reporter\'s copy (D6)', () => {
  it('keeps the last ten lines received, oldest first, both seats', () => {
    const inbox = new ChatInbox(() => true);
    for (let i = 0; i < 14; i++) inbox.deliver((i % 2) as 0 | 1, `n${i}`, () => undefined);
    const r = inbox.recent();
    expect(r).toHaveLength(10);
    expect(r[0]).toEqual({ seat: 0, text: 'n4' });
    expect(r[9]).toEqual({ seat: 1, text: 'n13' });
  });

  it('keeps a line from a muted or blocked seat (mute, then report, is the ordinary order) but not while chat is off', () => {
    let on = true;
    const inbox = new ChatInbox(() => on);
    inbox.useWho(whoWith([null, MEMBER]));
    inbox.setMuted(1, true);
    inbox.deliver(1, 'muted line', () => undefined);
    inbox.setBlocked(1, true);
    inbox.deliver(1, 'blocked line', () => undefined);
    on = false;
    inbox.deliver(1, 'chat off line', () => undefined);
    expect(inbox.recent().map((l) => l.text)).toEqual(['muted line', 'blocked line']);
  });

  it('hands out a copy, so a caller cannot rewrite the evidence', () => {
    const inbox = new ChatInbox(() => true);
    inbox.deliver(1, 'said', () => undefined);
    inbox.recent()[0]!.text = 'forged';
    expect(inbox.recent()[0]!.text).toBe('said');
  });

  it('tells a listener when a seat speaks for the first time (so the Report button can appear), and not on every line', () => {
    const inbox = new ChatInbox(() => true);
    const fn = vi.fn();
    inbox.onChange(fn);
    expect(inbox.hasHeard(1)).toBe(false);
    inbox.deliver(1, 'a', () => undefined);
    inbox.deliver(1, 'b', () => undefined);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(inbox.hasHeard(1)).toBe(true);
    expect(inbox.hasHeard(0)).toBe(false);
  });
});

// GH-1417 S3 review: the options object composes (S2's filter lands beside `who`), and a report dialog takes ONE snapshot.
describe('inboxOf options', () => {
  it('takes an options object: who and preview arrive independently and neither drops the other', () => {
    const transport = {};
    const blocks = createBlockList(store());
    const inbox = inboxOf(transport, () => true, { who: whoWith([null, MEMBER], blocks) });
    inboxOf(transport, () => true, { preview: (t) => (t === 'slur' ? null : t) });
    inbox.setBlocked(1, true);
    expect(inbox.verdict(1)).toBe('blocked');
    inbox.deliver(0, 'slur', () => undefined);
    expect(inbox.snapshot().shown).toEqual([null]);
  });
  it('a bare call keeps every default', () => {
    const inbox = inboxOf({}, () => true);
    inbox.deliver(1, 'hi', () => undefined);
    expect(inbox.snapshot().shown).toEqual(['hi']);
  });
});

describe('ChatInbox.snapshot', () => {
  it('is a copy taken at one instant: later lines and edits do not reach it', () => {
    const inbox = new ChatInbox(() => true);
    inbox.deliver(1, 'first', () => undefined);
    const snap = inbox.snapshot();
    inbox.deliver(1, 'second', () => undefined);
    snap.lines[0]!.text = 'forged';
    expect(snap.lines.map((l) => l.text)).toEqual(['forged']);
    expect(inbox.recent().map((l) => l.text)).toEqual(['first', 'second']);
  });
  it('keeps the RAW line as evidence and shows what the preview allows: a hidden line is null, a masked one is its mask', () => {
    const inbox = new ChatInbox(() => true);
    inbox.useOptions({ preview: (t) => (t.includes('hidden') ? null : t.replace('swear', '***')) });
    inbox.deliver(1, 'a hidden slur', () => undefined);
    inbox.deliver(1, 'a swear word', () => undefined);
    const snap = inbox.snapshot();
    expect(snap.lines.map((l) => l.text)).toEqual(['a hidden slur', 'a swear word']);
    expect(snap.shown).toEqual([null, 'a *** word']);
  });
});

