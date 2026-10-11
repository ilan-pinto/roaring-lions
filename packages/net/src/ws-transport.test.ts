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
    sock.recv({ t: 'lobby', config: null, seats: [{ seat: 1, callsign: 'B', connected: true, ready: false }], you: 1 });
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
    for (const final of [{ t: 'desync', tick: 20, hashes: [1, 2] }, { t: 'ended', reason: 'left' }]) {
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
});
