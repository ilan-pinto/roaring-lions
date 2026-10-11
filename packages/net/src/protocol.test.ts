import { describe, it, expect } from 'vitest';
import { parseClientMsg, parseServerMsg, MAX_MESSAGE_BYTES } from './protocol';
import type { MatchConfig } from './config';

const CFG: MatchConfig = {
  matchId: 'm1', code: 'ABCDEF', seed: 7, map: 'beit_sahwan_outskirts', mode: 'sandbox',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p0', callsign: 'Host', kind: 'human' },
    { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p1', callsign: 'Guest', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: '0.1', dataDigest: 0,
};

describe('parseClientMsg', () => {
  it('accepts every client kind', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'hello', ticket: 'abc', build: '0.1' }))).toEqual({ t: 'hello', ticket: 'abc', build: '0.1' });
    expect(parseClientMsg(JSON.stringify({ t: 'ready' }))).toEqual({ t: 'ready' });
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 3, cmd: { kind: 'halt', ids: [1] } }))).toEqual({ t: 'cmd', seq: 3, cmd: { kind: 'halt', ids: [1] } });
    expect(parseClientMsg(JSON.stringify({ t: 'ack', tick: 40 }))).toEqual({ t: 'ack', tick: 40 });
    expect(parseClientMsg(JSON.stringify({ t: 'hash', tick: 20, h: -5 }))).toEqual({ t: 'hash', tick: 20, h: -5 });
    expect(parseClientMsg(JSON.stringify({ t: 'bye' }))).toEqual({ t: 'bye' });
  });
  it('returns null on malformed JSON, an unknown kind, a wrong field type, and a message over the cap', () => {
    expect(parseClientMsg('{not json')).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'teleport' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'ack', tick: 'soon' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd: { kind: 'halt' } }))).toBeNull();
    const big = JSON.stringify({ t: 'cmd', seq: 1, cmd: { kind: 'halt', ids: Array.from({ length: 2000 }, (_, i) => i) } });
    expect(big.length).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(parseClientMsg(big)).toBeNull();
  });
  it('refuses a command whose kind the sim does not have', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 1, cmd: { kind: 'nuke', ids: [1] } }))).toBeNull();
  });
  it('passes a command through whole, unknown optional fields included', () => {
    const cmd = { kind: 'attackMove', ids: [1, 2], x: 65536, y: 131072, sweep: true };
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 2, cmd }))).toEqual({ t: 'cmd', seq: 2, cmd });
  });
});

describe('parseServerMsg', () => {
  it('round-trips a frame and refuses a frame whose cmds are not stamped', () => {
    const frame = { t: 'frame', tick: 7, cmds: [{ seat: 1, seq: 0, cmd: { kind: 'halt', ids: [4] } }] };
    expect(parseServerMsg(JSON.stringify(frame))).toEqual(frame);
    expect(parseServerMsg(JSON.stringify({ t: 'frame', tick: 7, cmds: [{ cmd: { kind: 'halt', ids: [4] } }] }))).toBeNull();
  });
  it('validates the config in start, lobby and log instead of casting it', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'start', config: {} }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'start', config: CFG }))).toEqual({ t: 'start', config: CFG });
    expect(parseServerMsg(JSON.stringify({ t: 'log', config: {}, frames: [] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'log', config: CFG, frames: [] }))).toEqual({ t: 'log', config: CFG, frames: [] });
    const seats = [{ seat: 0, callsign: 'Host', connected: true, ready: false }];
    expect(parseServerMsg(JSON.stringify({ t: 'lobby', config: null, seats, you: 0 }))).toEqual({ t: 'lobby', config: null, seats, you: 0 });
    expect(parseServerMsg(JSON.stringify({ t: 'lobby', config: CFG, seats, you: 0 }))).toEqual({ t: 'lobby', config: CFG, seats, you: 0 });
    expect(parseServerMsg(JSON.stringify({ t: 'lobby', config: {}, seats, you: 0 }))).toBeNull();
  });
  it('accepts only the declared error codes', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'error', code: 'full' }))).toEqual({ t: 'error', code: 'full' });
    expect(parseServerMsg(JSON.stringify({ t: 'error', code: 'teapot' }))).toBeNull();
  });
});
