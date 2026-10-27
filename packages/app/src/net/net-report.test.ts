import { describe, it, expect } from 'vitest';
import { LocalTransport, WsTransport, type MatchConfig, type SocketLike } from '@lions/net';
import { logRejoin, netReport, rejoinLines } from './net-report';
import type { ProducerStats } from './snapshot-producer';

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
  function seated(): WsTransport {
    const sock: SocketLike = { send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null };
    const t = new WsTransport(() => sock, 'tkt', 'b', { onStart: () => {} }, () => 0);
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ t: 'start', config: CONFIG }) });
    return t;
  }
  const STATS: ProducerStats = { encodes: 2, lastEncodeMs: 3, stored: 1, held: 0, recorded: 1, mismatch: 0, refused: 0, failed: 0, skipped: { behind: 4 } };
  it('carries the rejoin outcome and the producer counters (mismatch included) when given', () => {
    const r = netReport(seated(), 0, CONFIG, 5, { rejoin: { path: 'snapshot', from: 2400, restoreMs: 12 }, snapshot: STATS });
    expect(r?.rejoin).toEqual({ path: 'snapshot', from: 2400, restoreMs: 12 });
    expect(r?.snapshot).toEqual(STATS);
    expect(r?.snapshot?.mismatch).toBe(0);
    const full = netReport(seated(), 0, CONFIG, 5, { rejoin: { path: 'full', reason: 'none' } });
    expect(full?.rejoin).toEqual({ path: 'full', reason: 'none' });
  });
  it('has neither field when nothing is given, or when both are null (a tab that did not reload and does not produce)', () => {
    for (const r of [netReport(seated(), 0, CONFIG, 5), netReport(seated(), 0, CONFIG, 5, { rejoin: null, snapshot: null })]) {
      expect(r).not.toBeNull();
      expect(Object.hasOwn(r ?? {}, 'rejoin')).toBe(false);
      expect(Object.hasOwn(r ?? {}, 'snapshot')).toBe(false);
    }
  });
  it('is null for a single-player transport', () => {
    expect(netReport(new LocalTransport(), 0, null, 0)).toBeNull();
  });
});

describe('rejoinLines (the console lines of a rejoin)', () => {
  it('a snapshot rejoin prints one info line with the tick and the whole-millisecond restore, and no warning', () => {
    expect(rejoinLines({ path: 'snapshot', from: 2400, restoreMs: 12.6 })).toEqual({ info: '[net] rejoin: snapshot from 2400 in 13 ms', warn: null });
  });
  it('a fallback prints the info line and ONE warning, both naming the reason', () => {
    const l = rejoinLines({ path: 'full', reason: 'sha_mismatch' });
    expect(l.info).toBe('[net] rejoin: full log (sha_mismatch)');
    expect(l.warn).toBe('[net] snapshot rejoin fell back to the full log: sha_mismatch');
  });
  it('reason none (this reload never had a snapshot to use) prints the info line and NO warning (final review N1)', () => {
    expect(rejoinLines({ path: 'full', reason: 'none' })).toEqual({ info: '[net] rejoin: full log (none)', warn: null });
  });
});

describe('logRejoin (which console method a rejoin uses, G-2)', () => {
  /** A sink with ONLY info and warn, as the type says: an `error` call is a TypeError. */
  const sink = () => {
    const lines: { m: 'info' | 'warn'; text: string }[] = [];
    return { lines, s: { info: (t: string) => { lines.push({ m: 'info', text: t }); }, warn: (t: string) => { lines.push({ m: 'warn', text: t }); } } };
  };
  it('a snapshot rejoin is one info line and nothing else', () => {
    const { lines, s } = sink();
    logRejoin({ path: 'snapshot', from: 2400, restoreMs: 12 }, s);
    expect(lines).toEqual([{ m: 'info', text: '[net] rejoin: snapshot from 2400 in 12 ms' }]);
  });
  it('a fallback is an info line and ONE warning naming the reason, through info and warn only', () => {
    const { lines, s } = sink();
    logRejoin({ path: 'full', reason: 'sha_mismatch' }, s);
    expect(lines).toEqual([
      { m: 'info', text: '[net] rejoin: full log (sha_mismatch)' },
      { m: 'warn', text: '[net] snapshot rejoin fell back to the full log: sha_mismatch' },
    ]);
  });
  it('reason none is the info line alone through the sink', () => {
    const { lines, s } = sink();
    logRejoin({ path: 'full', reason: 'none' }, s);
    expect(lines).toEqual([{ m: 'info', text: '[net] rejoin: full log (none)' }]);
  });
  it('never mentions a ticket', () => {
    const { lines, s } = sink();
    logRejoin({ path: 'full', reason: 'fetch_failed' }, s);
    logRejoin({ path: 'snapshot', from: 1200, restoreMs: 3 }, s);
    for (const l of lines) expect(l.text).not.toMatch(/ticket|tk-|bearer/i);
  });
});
