import { describe, it, expect } from 'vitest';
import { LocalTransport, WsTransport, type MatchConfig, type SocketLike } from '@lions/net';
import { netReport } from './net-report';

const CONFIG: MatchConfig = {
  matchId: 'ABCDEF', code: 'ABCDEF', seed: 1, map: 'x', mode: 'sandbox',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'A', kind: 'human' },
    { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'B', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
};

describe('netReport (__lions.net)', () => {
  it('reads the room transport\'s counters with the seat, the room code and the tick', () => {
    const sock: SocketLike = { send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null };
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => 0);
    sock.onopen?.({});
    const recv = (m: unknown): void => sock.onmessage?.({ data: JSON.stringify(m) });
    recv({ t: 'start', config: CONFIG });
    recv({ t: 'hashOk', tick: 19 });
    recv({ t: 'hashOk', tick: 39 });
    const r = netReport(t, 1, CONFIG, 57);
    expect(r).toMatchObject({
      seat: 1, room: 'ABCDEF', tickCount: 57, status: { kind: 'live', behind: 0 },
      hashOk: { count: 2, lastTick: 39 }, desyncTick: null,
      reconnects: { count: 0, lastOutageMs: null, lastReplayMs: null },
    });
    expect(r?.stalls.behind).toEqual({ count: 0, longestMs: 0 });
  });
  it('is null for a single-player transport', () => {
    expect(netReport(new LocalTransport(), 0, null, 0)).toBeNull();
  });
});
