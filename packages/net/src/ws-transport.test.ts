import { afterEach, describe, it, expect, vi } from 'vitest';
import { WsTransport, RECONNECT_DELAY_MS, REPLACED_CLOSE_CODE, type SocketLike } from './ws-transport';
import type { MatchConfig } from './config';

const CONFIG: MatchConfig = {
  matchId: 'm', code: 'ABCDEF', seed: 1, map: 'x', mode: 'sandbox',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'A', kind: 'human' },
    { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'B', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
};

type Fake = SocketLike & { sent: string[]; open(): void; recv(msg: unknown): void; closeFromServer(code?: number): void; opened: number };

function fakeSocket(): Fake {
  const s: Fake = {
    sent: [], opened: 0, onopen: null, onmessage: null, onclose: null,
    send: (d) => { s.sent.push(d); },
    close: () => { s.onclose?.({}); },
    open: () => { s.opened++; s.onopen?.({}); },
    recv: (msg) => { s.onmessage?.({ data: JSON.stringify(msg) }); },
    closeFromServer: (code) => { s.onclose?.(code === undefined ? {} : { code }); },
  };
  return s;
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('WsTransport', () => {
  it('sends hello on open, start arrives, frames feed take() two behind, commands and acks go out', () => {
    const sock = fakeSocket();
    let started: MatchConfig | null = null;
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: (c) => { started = c; } });
    sock.open();
    expect(JSON.parse(sock.sent[0])).toEqual({ t: 'hello', ticket: 'tkt', build: 'b' });
    expect(t.status()).toEqual({ kind: 'waiting' });
    sock.recv({ t: 'start', config: CONFIG });
    expect(started).toEqual(CONFIG);
    t.queueCommand({ kind: 'halt', ids: [1] });
    expect(JSON.parse(sock.sent[1])).toEqual({ t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } });
    for (let tick = 0; tick < 3; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    expect(t.take(10).map((f) => f.tick)).toEqual([0]);
    t.reportTick(0, null);
    for (let tick = 1; tick <= 9; tick++) t.reportTick(tick, null);
    expect(JSON.parse(sock.sent[2])).toEqual({ t: 'ack', tick: 9 });
    t.reportTick(20, 12345);
    expect(JSON.parse(sock.sent[3])).toEqual({ t: 'hash', tick: 20, h: 12345 });
    expect(t.status()).toEqual({ kind: 'live', behind: 2 });
  });
  it('a stall is reported and cleared; a desync ends the transport', () => {
    const sock = fakeSocket();
    let desync: [number, number] | null = null;
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onDesync: (_, h) => { desync = h; } });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'stall', reason: 'behind', seat: 1 });
    expect(t.status()).toEqual({ kind: 'stalled', reason: 'behind', seat: 1 });
    sock.recv({ t: 'resume' });
    expect(t.status()).toEqual({ kind: 'live', behind: 0 });
    sock.recv({ t: 'desync', tick: 40, hashes: [1, 2] });
    expect(desync).toEqual([1, 2]);
    expect(t.status()).toEqual({ kind: 'desync', tick: 40 });
  });
  it('reconnects on close with the same ticket and ignores the log frames it already ran', () => {
    vi.useFakeTimers();
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    for (let tick = 0; tick < 5; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    expect(t.take(10).map((f) => f.tick)).toEqual([0, 1, 2]);
    sock.closeFromServer();
    expect(t.status()).toEqual({ kind: 'stalled', reason: 'connecting', seat: null });
    vi.runAllTimers();
    sock.open();
    expect(sock.opened).toBe(2);
    expect(sock.sent.map((s) => JSON.parse(s) as unknown).filter((m) => (m as { t: string }).t === 'hello'))
      .toEqual([{ t: 'hello', ticket: 'tkt', build: 'b' }, { t: 'hello', ticket: 'tkt', build: 'b' }]);
    sock.recv({ t: 'log', config: CONFIG, frames: Array.from({ length: 8 }, (_, tick) => ({ tick, cmds: [] })) });
    expect(t.take(10).map((f) => f.tick)).toEqual([3, 4, 5]);
  });
  it('a gap in the frames closes the socket, and the reconnect fetches the log that fills it', () => {
    vi.useFakeTimers();
    const sock = fakeSocket();
    let opens = 0;
    const t = new WsTransport(() => { opens++; return sock; }, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'frame', tick: 0, cmds: [] });
    sock.recv({ t: 'frame', tick: 2, cmds: [] });   // tick 1 never arrived
    expect(t.status()).toEqual({ kind: 'stalled', reason: 'connecting', seat: null });
    expect(t.take(10)).toEqual([]);
    expect(opens).toBe(1);
    vi.advanceTimersByTime(RECONNECT_DELAY_MS);
    expect(opens).toBe(2);
    sock.open();
    sock.recv({ t: 'log', config: CONFIG, frames: Array.from({ length: 4 }, (_, tick) => ({ tick, cmds: [] })) });
    expect(t.status()).toEqual({ kind: 'live', behind: 4 });
    expect(t.take(10).map((f) => f.tick)).toEqual([0, 1]);
  });
  it('a reconnect before the start is waiting again once the lobby answers', () => {
    vi.useFakeTimers();
    const sock = fakeSocket();
    const seen: number[] = [];
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onLobby: (_, you) => { seen.push(you); } });
    sock.open();
    sock.closeFromServer();
    expect(t.status()).toEqual({ kind: 'stalled', reason: 'connecting', seat: null });
    vi.runAllTimers();
    sock.open();
    sock.recv({ t: 'lobby', config: null, seats: [{ seat: 1, callsign: 'B', connected: true, ready: false }], you: 1, map: 'tel_marum' });
    expect(seen).toEqual([1]);
    expect(t.status()).toEqual({ kind: 'waiting' });
  });
  it('a replaced socket that closes late does not stall the new one or reconnect again', () => {
    vi.useFakeTimers();
    const a = fakeSocket();
    const b = fakeSocket();
    const socks = [a, b];
    let opens = 0;
    const t = new WsTransport(() => socks[opens++] ?? b, 'tkt', 'b', { onStart: () => {} });
    a.open();
    a.recv({ t: 'start', config: CONFIG });
    a.closeFromServer();
    vi.runAllTimers();
    b.open();
    b.recv({ t: 'log', config: CONFIG, frames: [] });
    expect(t.status()).toEqual({ kind: 'live', behind: 0 });
    a.closeFromServer();   // the old socket's close, delivered late
    vi.runAllTimers();
    expect(opens).toBe(2);
    expect(t.status()).toEqual({ kind: 'live', behind: 0 });
  });
  it('runs the frames it holds while stalled, and stays stalled until the room resumes (R31)', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    for (let tick = 0; tick < 6; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    sock.recv({ t: 'stall', reason: 'behind', seat: 0 });
    expect(t.take(10).map((f) => f.tick)).toEqual([0, 1, 2, 3]);
    expect(t.status()).toEqual({ kind: 'stalled', reason: 'behind', seat: 0 });
    sock.recv({ t: 'resume' });
    expect(t.status()).toEqual({ kind: 'live', behind: 2 });
  });
  it('after a desync or an end, nothing the room sends revives it', () => {
    for (const final of [{ t: 'desync', tick: 20, hashes: [1, 2] }, { t: 'ended', reason: 'void' }, { t: 'ended', reason: 'expired' }]) {
      const sock = fakeSocket();
      const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
      sock.open();
      sock.recv({ t: 'start', config: CONFIG });
      for (let tick = 0; tick < 3; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
      sock.recv(final);
      const before = t.status();
      sock.recv({ t: 'stall', reason: 'gone', seat: 1 });
      sock.recv({ t: 'resume' });
      sock.recv({ t: 'frame', tick: 3, cmds: [] });
      sock.recv({ t: 'log', config: CONFIG, frames: [] });
      expect(t.status()).toEqual(before);
      expect(t.take(10)).toEqual([]);
    }
  });
  it('a socket closed as replaced does not reconnect: two tabs on one ticket must not take turns', () => {
    vi.useFakeTimers();
    const sock = fakeSocket();
    let opens = 0;
    const t = new WsTransport(() => { opens++; return sock; }, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.closeFromServer(REPLACED_CLOSE_CODE);
    expect(t.status()).toEqual({ kind: 'closed', reason: 'replaced' });
    vi.runAllTimers();
    expect(opens).toBe(1);
  });
  it('a browser WebSocket is a SocketLike (checked by tsc, never opened)', () => {
    const make: () => SocketLike = () => new WebSocket('ws://never.invalid');
    expect(typeof make).toBe('function');
  });
  it('close() says bye, and the closing socket does not reconnect', () => {
    vi.useFakeTimers();
    const sock = fakeSocket();
    let opens = 0;
    const t = new WsTransport(() => { opens++; return sock; }, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    t.close();
    expect(JSON.parse(sock.sent.at(-1) ?? '')).toEqual({ t: 'bye' });
    vi.runAllTimers();
    expect(opens).toBe(1);
    expect(t.status()).toEqual({ kind: 'closed', reason: 'left' });
  });

  it('pause, resume, surrender and chat each send their message', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    const before = sock.sent.length;
    t.pause(); t.resume(); t.surrender(); t.chat('gg');
    expect(sock.sent.slice(before).map((m) => JSON.parse(m) as unknown)).toEqual([
      { t: 'pause' }, { t: 'resume' }, { t: 'surrender' }, { t: 'chat', text: 'gg' },
    ]);
  });
  it('a received cmdRefused calls onCmdRefused, once per message, and changes no status', () => {
    const sock = fakeSocket();
    let refused = 0;
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onCmdRefused: () => { refused++; } });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'paused', seat: 0, remainingMs: 5000, pausesLeft: [2, 3] });
    sock.recv({ t: 'cmdRefused' });
    sock.recv({ t: 'cmdRefused' });
    expect(refused).toBe(2);
    expect(t.status().kind).toBe('paused');
  });
  it('a received paused sets the paused status and calls onPaused; the room\'s resume returns to live', () => {
    const sock = fakeSocket();
    const clock = { ms: 1000 };
    const seen: unknown[] = [];
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onPaused: (...a) => { seen.push(a); } }, () => clock.ms);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'paused', seat: 1, remainingMs: 30000, pausesLeft: [2, 1] });
    expect(t.status()).toEqual({ kind: 'paused', seat: 1, untilMs: 31000 });
    expect(seen).toEqual([[1, 30000, [2, 1]]]);
    sock.recv({ t: 'resume' });
    expect(t.status()).toEqual({ kind: 'live', behind: 0 });
  });
  it('paused persists through frames, and take() runs the frames it holds while paused (R-B5)', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => 0);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    for (let tick = 0; tick < 4; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    sock.recv({ t: 'paused', seat: 0, remainingMs: 5000, pausesLeft: [1, 2] });
    sock.recv({ t: 'frame', tick: 4, cmds: [] });
    expect(t.status()).toEqual({ kind: 'paused', seat: 0, untilMs: 5000 });
    expect(t.take(10).map((f) => f.tick)).toEqual([0, 1, 2]);
    expect(t.status()).toEqual({ kind: 'paused', seat: 0, untilMs: 5000 });
    sock.recv({ t: 'resume' });
    expect(t.status()).toEqual({ kind: 'live', behind: 2 });
  });
  it('a stall that arrives during a pause is counted but does not replace the paused status', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => 0);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'paused', seat: 0, remainingMs: 5000, pausesLeft: [1, 2] });
    sock.recv({ t: 'stall', reason: 'gone', seat: 1 });
    expect(t.status()).toEqual({ kind: 'paused', seat: 0, untilMs: 5000 });
    expect(t.stats().stalls.gone.count).toBe(1);
  });
  it('a pause ends with a terminal message too', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => 0);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'paused', seat: 0, remainingMs: 5000, pausesLeft: [1, 2] });
    sock.recv({ t: 'ended', reason: 'expired' });
    expect(t.status()).toEqual({ kind: 'closed', reason: 'expired' });
  });
  it('a received chat calls onChat with the seat and text', () => {
    const sock = fakeSocket();
    const seen: unknown[] = [];
    new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onChat: (seat, text) => { seen.push([seat, text]); } });
    sock.open();
    sock.recv({ t: 'chat', seat: 1, text: 'hello' });
    expect(seen).toEqual([[1, 'hello']]);
  });
  it('an ended surrender calls onEnded with the reason and the seat', () => {
    const sock = fakeSocket();
    const seen: unknown[] = [];
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onEnded: (...a) => { seen.push(a); } });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'ended', reason: 'surrender', seat: 1 });
    expect(seen).toEqual([['surrender', 1]]);
    expect(t.status()).toEqual({ kind: 'closed', reason: 'surrender' });
  });
  it('after ended left, surrender or forfeit take() drains the frames already received, then yields none (R-B5)', () => {
    for (const reason of ['left', 'surrender', 'forfeit'] as const) {
      const sock = fakeSocket();
      const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
      sock.open();
      sock.recv({ t: 'start', config: CONFIG });
      for (let tick = 0; tick < 5; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
      expect(t.take(2).map((f) => f.tick)).toEqual([0, 1]);
      sock.recv({ t: 'ended', reason, seat: 0 });
      sock.recv({ t: 'frame', tick: 5, cmds: [] });   // nothing the room says afterwards is taken
      expect(t.take(10).map((f) => f.tick)).toEqual([2, 3, 4]);
      expect(t.take(10)).toEqual([]);
      expect(t.status()).toEqual({ kind: 'closed', reason });
    }
  });
  it('after desync or void nothing drains', () => {
    for (const final of [{ t: 'desync', tick: 20, hashes: [1, 2] }, { t: 'ended', reason: 'void' }]) {
      const sock = fakeSocket();
      const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
      sock.open();
      sock.recv({ t: 'start', config: CONFIG });
      for (let tick = 0; tick < 5; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
      sock.recv(final);
      expect(t.take(10)).toEqual([]);
    }
  });
  it('detach() says no bye, closes the socket, and does not reconnect when the close arrives', () => {
    vi.useFakeTimers();
    const sock = fakeSocket();
    let opens = 0;
    const t = new WsTransport(() => { opens++; return sock; }, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    const before = sock.sent.length;
    let closes = 0;
    const realClose = sock.close;
    sock.close = () => { closes++; realClose(); };
    t.detach();
    expect(closes).toBe(1);
    expect(sock.sent.length).toBe(before);   // no bye
    sock.closeFromServer();
    vi.runAllTimers();
    expect(opens).toBe(1);
  });
  it('behind() is the clock\'s backlog in every status, a stall and a pause included (I-1)', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    expect(t.behind()).toBe(0);
    sock.open();
    sock.recv({ t: 'log', config: CONFIG, frames: Array.from({ length: 600 }, (_, tick) => ({ tick, cmds: [] })) });
    expect(t.behind()).toBe(600);
    sock.recv({ t: 'stall', reason: 'behind', seat: 1 });
    expect(t.status().kind).toBe('stalled');
    expect(t.behind()).toBe(600);
    t.take(100);
    expect(t.behind()).toBe(500);
    sock.recv({ t: 'paused', seat: 0, remainingMs: 90000, pausesLeft: [2, 3] });
    t.take(50);
    expect(t.behind()).toBe(450);
  });
  it('setHooks replays the room\'s ending to an onEnded it installs, and a pause in force to an onPaused (M-2)', () => {
    let now = 5000;
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => now);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'paused', seat: 1, remainingMs: 90000, pausesLeft: [3, 2] });
    now += 1000;
    const seen: unknown[] = [];
    t.setHooks({ onPaused: (seat, ms, left) => { seen.push(['paused', seat, ms, left]); } });
    expect(seen).toEqual([['paused', 1, 89000, [3, 2]]]);
    // Only the hooks a call names hear the replay.
    t.setHooks({ onChat: () => {} });
    expect(seen).toHaveLength(1);
    sock.recv({ t: 'ended', reason: 'surrender', seat: 0 });
    t.setHooks({ onEnded: (reason, seat) => { seen.push(['ended', reason, seat]); } });
    expect(seen.at(-1)).toEqual(['ended', 'surrender', 0]);
  });
  it('setHooks replays nothing that the ROOM did not say: no live pause, and this seat\'s own close or detach is not an ending', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    const seen: unknown[] = [];
    t.setHooks({ onEnded: () => { seen.push('ended'); }, onPaused: () => { seen.push('paused'); } });
    t.close();
    t.setHooks({ onEnded: () => { seen.push('ended'); } });
    const sock2 = fakeSocket();
    const t2 = new WsTransport(() => sock2, 'tkt', 'b', { onStart: () => {} });
    sock2.open();
    t2.detach();
    t2.setHooks({ onEnded: () => { seen.push('ended'); } });
    expect(seen).toEqual([]);
  });
  it('setHooks replaces only the hooks it names', () => {
    const sock = fakeSocket();
    const calls: string[] = [];
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => { calls.push('start1'); }, onChat: () => { calls.push('chat1'); } });
    t.setHooks({ onChat: () => { calls.push('chat2'); } });
    sock.open();
    sock.recv({ t: 'chat', seat: 0, text: 'x' });
    sock.recv({ t: 'start', config: CONFIG });
    expect(calls).toEqual(['chat2', 'start1']);
  });
  it('onLobby carries the lobby message\'s map (R-B2)', () => {
    const sock = fakeSocket();
    const seen: unknown[] = [];
    new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onLobby: (seats, you, map) => { seen.push([seats.length, you, map]); } });
    sock.open();
    sock.recv({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'A', connected: true, ready: false }], you: 0, map: 'tel_marum' });
    expect(seen).toEqual([[1, 0, 'tel_marum']]);
  });

  it('onLobby carries the lobby\'s factions by seat, and nothing for an older room (2026-10-14)', () => {
    const sock = fakeSocket();
    const seen: unknown[] = [];
    new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onLobby: (_s, _y, _m, factions) => { seen.push(factions); } });
    sock.open();
    sock.recv({ t: 'lobby', config: null, seats: [], you: 1, map: 'tel_marum', factions: ['kdf', 'sarim'] });
    sock.recv({ t: 'lobby', config: null, seats: [], you: 1, map: 'tel_marum' });
    expect(seen).toEqual([['kdf', 'sarim'], undefined]);
  });

});

describe('WsTransport: the result reported to the room (L-1, R-B26)', () => {
  const sentOf = (sock: Fake, t: string): unknown[] => sock.sent.map((x) => JSON.parse(x) as { t: string }).filter((m) => m.t === t);
  it('over(tick) sends one over, however often it is called', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    t.over(399);
    t.over(399);
    t.over(419);
    expect(sentOf(sock, 'over')).toEqual([{ t: 'over', tick: 399 }]);
  });
  it('a report made before a drop is said again once the room answers the reconnect (a send into a dead socket is lost)', () => {
    vi.useFakeTimers();
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'log', config: CONFIG, frames: [] });   // no report yet: a log says nothing
    expect(sentOf(sock, 'over')).toEqual([]);
    t.over(399);
    sock.closeFromServer();
    vi.runAllTimers();
    sock.open();
    expect(sentOf(sock, 'over')).toHaveLength(1);   // not before the room has the seat back
    sock.recv({ t: 'log', config: CONFIG, frames: [] });
    expect(sentOf(sock, 'over')).toEqual([{ t: 'over', tick: 399 }, { t: 'over', tick: 399 }]);
  });
  it('ended over: onEnded hears it, the transport closes, and the frames already received still drain', () => {
    const sock = fakeSocket();
    const seen: unknown[] = [];
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {}, onEnded: (...a) => { seen.push(a); } });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    for (let tick = 0; tick < 5; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    expect(t.take(2).map((f) => f.tick)).toEqual([0, 1]);
    sock.recv({ t: 'ended', reason: 'over' });
    expect(seen).toEqual([['over', undefined]]);
    expect(t.status()).toEqual({ kind: 'closed', reason: 'over' });
    expect(t.take(10).map((f) => f.tick)).toEqual([2, 3, 4]);
    t.over(4);
    expect(sentOf(sock, 'over')).toEqual([]);   // the room is gone: nothing to report to
  });
});

describe('WsTransport stats (N0 final review I1: positive evidence)', () => {
  /** A transport on a hand-set wall clock, started. */
  function started(): { t: WsTransport; sock: Fake; clock: { ms: number } } {
    const clock = { ms: 0 };
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => clock.ms);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    return { t, sock, clock };
  }

  it('counts every hashOk and remembers the last tick; a desync records its tick', () => {
    const { t, sock } = started();
    expect(t.stats().hashOk).toEqual({ count: 0, lastTick: null });
    for (const tick of [19, 39, 59]) sock.recv({ t: 'hashOk', tick });
    expect(t.stats().hashOk).toEqual({ count: 3, lastTick: 59 });
    expect(t.stats().desyncTick).toBeNull();
    sock.recv({ t: 'desync', tick: 79, hashes: [1, 2] });
    expect(t.stats().desyncTick).toBe(79);
    sock.recv({ t: 'hashOk', tick: 99 });   // nothing after a desync counts
    expect(t.stats().hashOk.count).toBe(3);
  });

  it('counts stalls by reason, once each, and keeps the longest', () => {
    const { t, sock, clock } = started();
    clock.ms = 1000; sock.recv({ t: 'stall', reason: 'behind', seat: 1 });
    clock.ms = 1200; sock.recv({ t: 'stall', reason: 'behind', seat: 0 });   // the same stall, said again
    clock.ms = 1600; sock.recv({ t: 'resume' });
    clock.ms = 2000; sock.recv({ t: 'stall', reason: 'behind', seat: 1 });
    clock.ms = 2100; sock.recv({ t: 'resume' });
    clock.ms = 3000; sock.recv({ t: 'stall', reason: 'gone', seat: 1 });
    clock.ms = 3250;
    const s = t.stats().stalls;
    expect(s.behind).toEqual({ count: 2, longestMs: 600 });
    expect(s.gone).toEqual({ count: 1, longestMs: 250 });   // still open: timed to now
    expect(s.connecting).toEqual({ count: 0, longestMs: 0 });
    clock.ms = 4000; sock.recv({ t: 'resume' });
    clock.ms = 9000;
    expect(t.stats().stalls.gone).toEqual({ count: 1, longestMs: 1000 });   // closed: no longer grows
  });

  it('a drop mid-stall ends the room\'s stall and starts a connecting one', () => {
    vi.useFakeTimers();
    const { t, sock, clock } = started();
    clock.ms = 100; sock.recv({ t: 'stall', reason: 'behind', seat: 1 });
    clock.ms = 400; sock.closeFromServer();
    clock.ms = 900;
    const s = t.stats().stalls;
    expect(s.behind).toEqual({ count: 1, longestMs: 300 });
    expect(s.connecting).toEqual({ count: 1, longestMs: 500 });
  });

  it('times a reconnect: one outage however many attempts, then the log run down to the buffer', () => {
    vi.useFakeTimers();
    const { t, sock, clock } = started();
    for (let tick = 0; tick < 5; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    expect(t.take(10).map((f) => f.tick)).toEqual([0, 1, 2]);
    clock.ms = 5000; sock.closeFromServer();
    vi.advanceTimersByTime(RECONNECT_DELAY_MS);
    clock.ms = 6000; sock.closeFromServer();   // the first attempt fails too
    vi.advanceTimersByTime(RECONNECT_DELAY_MS);
    sock.open();
    expect(t.stats().reconnects).toEqual({ count: 0, lastOutageMs: null, lastReplayMs: null });
    clock.ms = 6500;
    sock.recv({ t: 'log', config: CONFIG, frames: Array.from({ length: 30 }, (_, tick) => ({ tick, cmds: [] })) });
    expect(t.stats().reconnects).toEqual({ count: 1, lastOutageMs: 1500, lastReplayMs: null });
    expect(t.stats().stalls.connecting).toEqual({ count: 1, longestMs: 1500 });
    clock.ms = 6600; t.take(10);   // 3..12: still 17 behind
    expect(t.stats().reconnects.lastReplayMs).toBeNull();
    clock.ms = 6800; t.take(100);  // run down to the buffer
    expect(t.stats().reconnects).toEqual({ count: 1, lastOutageMs: 1500, lastReplayMs: 300 });
  });

  it('a reconnect before the start counts when the lobby answers', () => {
    vi.useFakeTimers();
    const clock = { ms: 0 };
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => clock.ms);
    sock.open();
    clock.ms = 50; sock.closeFromServer();
    vi.runAllTimers();
    sock.open();
    clock.ms = 1250;
    sock.recv({ t: 'lobby', config: null, seats: [], you: 0, map: 'tel_marum' });
    expect(t.stats().reconnects).toEqual({ count: 1, lastOutageMs: 1200, lastReplayMs: null });
  });

  it('stats() is a snapshot: changing it changes nothing', () => {
    const { t, sock } = started();
    sock.recv({ t: 'hashOk', tick: 19 });
    const a = t.stats();
    a.hashOk.count = 99;
    a.stalls.behind.count = 99;
    expect(t.stats().hashOk.count).toBe(1);
    expect(t.stats().stalls.behind.count).toBe(0);
  });
});

describe('WsTransport: a log in parts (#559 H-1)', () => {
  it('stays connecting until the last part, then is live with every part\'s frames, relinked once, and repeats its over once', () => {
    vi.useFakeTimers();
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    for (let tick = 0; tick < 3; tick++) sock.recv({ t: 'frame', tick, cmds: [] });
    t.over(0);
    sock.closeFromServer();
    vi.runAllTimers();
    sock.open();
    const frames = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ tick: from + i, cmds: [] }));
    const overs = () => sock.sent.filter((m) => (JSON.parse(m) as { t: string }).t === 'over').length;
    sock.recv({ t: 'log', config: CONFIG, frames: frames(0, 10), part: 0, parts: 3 });
    expect(t.status()).toEqual({ kind: 'stalled', reason: 'connecting', seat: null });
    sock.recv({ t: 'log', config: CONFIG, frames: frames(10, 10), part: 1, parts: 3 });
    expect(t.status().kind).toBe('stalled');
    expect(t.stats().reconnects.count).toBe(0);
    expect(overs()).toBe(1);
    sock.recv({ t: 'log', config: CONFIG, frames: frames(20, 5), part: 2, parts: 3 });
    expect(t.status()).toEqual({ kind: 'live', behind: 25 });
    expect(t.stats().reconnects.count).toBe(1);
    expect(overs()).toBe(2);
    expect(t.take(100).map((f) => f.tick)).toEqual([...Array(23).keys()]);
  });

  // The lead's ruling (2026-10-13): a versus seat disconnected for 60 s loses.
  it('dropped starts the other seat\'s forfeit clock on this machine\'s wall clock; back, an ending and a desync clear it', () => {
    let now = 5_000;
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => now);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    expect(t.forfeitClock()).toBeNull();
    sock.recv({ t: 'dropped', seat: 1, remainingMs: 60_000 });
    expect(t.forfeitClock()).toEqual({ seat: 1, untilMs: 65_000 });
    now = 20_000;
    sock.recv({ t: 'back', seat: 0 });   // not the seat that dropped
    expect(t.forfeitClock()).toEqual({ seat: 1, untilMs: 65_000 });
    sock.recv({ t: 'back', seat: 1 });
    expect(t.forfeitClock()).toBeNull();
    sock.recv({ t: 'dropped', seat: 1, remainingMs: 60_000 });
    sock.recv({ t: 'ended', reason: 'forfeit', seat: 1 });
    expect(t.forfeitClock()).toBeNull();
    expect(t.status()).toEqual({ kind: 'closed', reason: 'forfeit' });
    const s2 = fakeSocket();
    const t2 = new WsTransport(() => s2, 'tkt', 'b', { onStart: () => {} }, () => now);
    s2.open();
    s2.recv({ t: 'start', config: CONFIG });
    s2.recv({ t: 'dropped', seat: 0, remainingMs: 1000 });
    s2.recv({ t: 'desync', tick: 19, hashes: [1, 2] });
    expect(t2.forfeitClock()).toBeNull();
  });
  it('a log (this seat relinked) clears a stale forfeit clock; the room re-sends it behind the log if it still runs', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => 0);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.recv({ t: 'dropped', seat: 1, remainingMs: 60_000 });
    sock.recv({ t: 'log', config: CONFIG, frames: [] });
    expect(t.forfeitClock()).toBeNull();
    sock.recv({ t: 'dropped', seat: 1, remainingMs: 30_000 });
    expect(t.forfeitClock()).toEqual({ seat: 1, untilMs: 30_000 });
  });
});

describe('N4a: the advisor role, advisor and done messages, the round stall', () => {
  it('a role: advisor transport sends no ack, hash, ready, over or bye (but does say hello)', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => 0, 'advisor');
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.sent.length = 0;
    t.reportTick(19, 123);
    t.ready();
    t.over(5);
    t.close();
    expect(sock.sent).toEqual([]);
  });
  it('a seat transport still sends all five (the same calls, the default role)', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => 0);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    sock.sent.length = 0;
    t.reportTick(19, 123);
    t.ready();
    t.over(5);
    t.close();
    expect(sock.sent.map((s) => (JSON.parse(s) as { t: string }).t)).toEqual(['ack', 'hash', 'ready', 'over', 'bye']);
  });
  it('an advisor still says hello, and advisor() and done() send their messages', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => 0, 'advisor');
    sock.open();
    t.advisor({ kind: 'ping', x: 3, y: 4 });
    t.done(2);
    expect(sock.sent.map((s) => JSON.parse(s))).toEqual([
      { t: 'hello', ticket: 'tkt', build: 'b' },
      { t: 'advisor', a: { kind: 'ping', x: 3, y: 4 } },
      { t: 'done', round: 2 },
    ]);
  });
  it('onAdvisor and onAdvisors fire with what the room relayed', () => {
    const sock = fakeSocket();
    const heard: unknown[] = [];
    new WsTransport(() => sock, 'tkt', 'b', {
      onStart: () => {},
      onAdvisor: (from, a) => { heard.push(['advisor', from, a]); },
      onAdvisors: (present) => { heard.push(['advisors', present]); },
    });
    sock.open();
    sock.recv({ t: 'advisor', from: 'advisor', a: { kind: 'text', text: 'hold' } });
    sock.recv({ t: 'advisors', present: [null, 'assist'] });
    sock.recv({ t: 'advisor', from: 'advisor', a: { kind: 'ping', x: 999, y: 0 } });   // unparseable: dropped by the parser
    expect(heard).toEqual([
      ['advisor', 'advisor', { kind: 'text', text: 'hold' }],
      ['advisors', [null, 'assist']],
    ]);
  });
  it('stats().stalls.round counts a round stall, once from its start, with its longest', () => {
    let now = 0;
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => now);
    sock.open();
    sock.recv({ t: 'start', config: CONFIG });
    expect(t.stats().stalls.round).toEqual({ count: 0, longestMs: 0 });
    now = 1000;
    sock.recv({ t: 'stall', reason: 'round', seat: 1 });
    sock.recv({ t: 'stall', reason: 'round', seat: 1 });
    expect(t.status()).toEqual({ kind: 'stalled', reason: 'round', seat: 1 });
    now = 3500;
    expect(t.stats().stalls.round).toEqual({ count: 1, longestMs: 2500 });
    sock.recv({ t: 'resume' });
    now = 9000;
    expect(t.stats().stalls.round).toEqual({ count: 1, longestMs: 2500 });
    expect(t.stats().stalls.behind.count).toBe(0);
  });
});

describe('N4a: a paced room releases a closed round past the buffer', () => {
  const PACED: MatchConfig = { ...CONFIG, mode: 'versus', pace: { kind: 'paced', roundTicks: 20, roundWallMs: 5000 } };
  const feed = (sock: Fake, from: number, to: number): void => { for (let tick = from; tick <= to; tick++) sock.recv({ t: 'frame', tick, cmds: [] }); };
  it('paced: every frame of a closed round is runnable at once, and the next round is held behind the buffer again', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: PACED });
    // Round 0 closes on tick 19: the room mints no more until the bot is done,
    // so ticks 18 and 19 must not wait behind a buffer that will never fill.
    feed(sock, 0, 19);
    expect(t.take(100).map((f) => f.tick)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(t.behind()).toBe(0);
    // Part of round 1: the open round keeps the realtime buffer.
    feed(sock, 20, 25);
    expect(t.take(100).map((f) => f.tick)).toEqual([20, 21, 22, 23]);
    // Round 1 closes: the rest is released.
    feed(sock, 26, 39);
    expect(t.take(100).map((f) => f.tick)).toEqual(Array.from({ length: 16 }, (_, i) => 24 + i));
    // maxTicks still bounds a batch.
    feed(sock, 40, 59);
    expect(t.take(5).map((f) => f.tick)).toEqual([40, 41, 42, 43, 44]);
  });
  it('realtime: unchanged -- frames stay bufferTicks behind the newest, at a "round boundary" too', () => {
    const sock = fakeSocket();
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} });
    sock.open();
    sock.recv({ t: 'start', config: { ...CONFIG, mode: 'versus' } });
    feed(sock, 0, 19);
    expect(t.take(100).map((f) => f.tick)).toEqual(Array.from({ length: 18 }, (_, i) => i));
    expect(t.behind()).toBe(2);
    feed(sock, 20, 39);
    expect(t.take(100).at(-1)?.tick).toBe(37);
  });
});
