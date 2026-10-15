import { describe, it, expect } from 'vitest';
import { endingLoser, parseClientMsg, parseServerMsg, FORFEIT_MS, MAX_MESSAGE_BYTES, MAX_CMD_IDS, OVER_CLOSE_MS } from './protocol';
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
  it('passes every declared field of a command through', () => {
    const cmd = { kind: 'attackMove', ids: [1, 2], x: 65536, y: 131072, sweep: true, append: true, exact: false };
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 2, cmd }))).toEqual({ t: 'cmd', seq: 2, cmd });
  });
  it('#559 H-1: rebuilds a command from its declared fields, so an unknown field never reaches a frame', () => {
    const pad = 'A'.repeat(3000);
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ kind: 'halt', ids: [0], pad }, { kind: 'halt', ids: [0] }],
      [{ kind: 'move', ids: [1], x: 0, y: 0, pad }, { kind: 'move', ids: [1], x: 0, y: 0 }],
      [{ kind: 'attackMove', ids: [1], x: 0, y: 0, sweep: true, pad }, { kind: 'attackMove', ids: [1], x: 0, y: 0, sweep: true }],
      [{ kind: 'garrison', ids: [1], structure: 2, pad }, { kind: 'garrison', ids: [1], structure: 2 }],
      [{ kind: 'demolish', ids: [1], structure: 2, pad }, { kind: 'demolish', ids: [1], structure: 2 }],
      [{ kind: 'load', ids: [1], carrier: 2, pad }, { kind: 'load', ids: [1], carrier: 2 }],
      [{ kind: 'unload', ids: [1], pad }, { kind: 'unload', ids: [1] }],
      [{ kind: 'chargeTunnel', ids: [1], tunnel: 0, pad }, { kind: 'chargeTunnel', ids: [1], tunnel: 0 }],
      [{ kind: 'reveal', side: 0, x: 1, y: 2, pad }, { kind: 'reveal', side: 0, x: 1, y: 2 }],
      [{ kind: 'callStrike', caller: 3, x: 1, y: 2, pad }, { kind: 'callStrike', caller: 3, x: 1, y: 2 }],
      // F1 Task 6 (F-R5): the fire-support profile survives the rebuild.
      [{ kind: 'callStrike', caller: 3, x: 1, y: 2, profile: 1, pad }, { kind: 'callStrike', caller: 3, x: 1, y: 2, profile: 1 }],
      [{ kind: 'smoke', ids: [1], x: 1, y: 2, pad }, { kind: 'smoke', ids: [1], x: 1, y: 2 }],
      [{ kind: 'attack', ids: [1, 2], target: 14, pad }, { kind: 'attack', ids: [1, 2], target: 14 }],
    ];
    for (const [sent, kept] of cases) {
      const parsed = parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd: sent }));
      expect(parsed).toEqual({ t: 'cmd', seq: 0, cmd: kept });
      expect(JSON.stringify(parsed)).not.toContain('AAAA');
    }
  });
  it('F1 Task 6 (F-R5): a callStrike profile is optional, an index into FIRE_SUPPORT, and refused otherwise', () => {
    const parse = (cmd: Record<string, unknown>) => parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd }));
    const base = { kind: 'callStrike', caller: 3, x: 1, y: 2 };
    for (const profile of [0, 1, 2]) {
      expect(parse({ ...base, profile })).toEqual({ t: 'cmd', seq: 0, cmd: { ...base, profile } });
    }
    expect(parse(base)).toEqual({ t: 'cmd', seq: 0, cmd: base });
    // Three profiles ship (air strike, barrage, smoke screen): 3 is one past the table.
    for (const profile of [3, -1, 1.5, '1', null]) expect(parse({ ...base, profile })).toBeNull();
  });
  it('#559 F2: dedupes ids, keeps their first order, and refuses more than MAX_CMD_IDS distinct ids', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [3, 1, 3, 3, 1, 2] } })))
      .toEqual({ t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [3, 1, 2] } });
    const ids = (n: number) => Array.from({ length: n }, (_, i) => i);
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: ids(MAX_CMD_IDS) } }))).not.toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: ids(MAX_CMD_IDS + 1) } }))).toBeNull();
    // Duplicates do not count against the cap: what is kept is what is bounded.
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [...ids(MAX_CMD_IDS), 0, 1, 2] } }))).not.toBeNull();
  });
  it('GH-420: accepts an attack with ids and an integer target, and refuses the rest', () => {
    const ok = { kind: 'attack', ids: [1, 2], target: 14 };
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd: ok }))).toEqual({ t: 'cmd', seq: 0, cmd: ok });
    for (const bad of [
      { kind: 'attack', ids: [1] },
      { kind: 'attack', ids: [1], target: 1.5 },
      { kind: 'attack', ids: [1], target: '14' },
      { kind: 'attack', target: 14 },
    ]) {
      expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd: bad }))).toBeNull();
    }
  });
  it('checks attack-move sweep as a boolean when present', () => {
    const ok = { kind: 'attackMove', ids: [1], x: 0, y: 0, sweep: true };
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd: ok }))).toEqual({ t: 'cmd', seq: 0, cmd: ok });
    const bad = { kind: 'attackMove', ids: [1], x: 0, y: 0, sweep: 'yes' };
    expect(parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd: bad }))).toBeNull();
  });
});

describe('parseServerMsg: a log in parts (#559 H-1)', () => {
  it('keeps part and parts when both are sane, and refuses a part outside its count', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'log', config: CFG, frames: [], part: 1, parts: 3 }))).toEqual({ t: 'log', config: CFG, frames: [], part: 1, parts: 3 });
    expect(parseServerMsg(JSON.stringify({ t: 'log', config: CFG, frames: [], part: 3, parts: 3 }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'log', config: CFG, frames: [], part: 0 }))).toBeNull();
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
    expect(parseServerMsg(JSON.stringify({ t: 'lobby', config: null, seats, you: 0, map: 'm' }))).toEqual({ t: 'lobby', config: null, seats, you: 0, map: 'm' });
    expect(parseServerMsg(JSON.stringify({ t: 'lobby', config: CFG, seats, you: 0, map: 'm' }))).toEqual({ t: 'lobby', config: CFG, seats, you: 0, map: 'm' });
    expect(parseServerMsg(JSON.stringify({ t: 'lobby', config: {}, seats, you: 0, map: 'm' }))).toBeNull();
  });
  it('accepts only the declared error codes', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'error', code: 'full' }))).toEqual({ t: 'error', code: 'full' });
    expect(parseServerMsg(JSON.stringify({ t: 'error', code: 'teapot' }))).toBeNull();
  });
});

describe('N1b messages', () => {
  it('parses the four new client messages', () => {
    for (const m of [{ t: 'pause' }, { t: 'resume' }, { t: 'surrender' }, { t: 'chat', text: 'gg' }]) {
      expect(parseClientMsg(JSON.stringify(m))).toEqual(m);
    }
  });
  it('refuses chat that is not a string or is over the cap', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'chat', text: 5 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'chat', text: 'x'.repeat(281) }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'chat', text: 'x'.repeat(280) }))).not.toBeNull();
  });
  it('parses paused, chat, a lobby with its map, and a surrender', () => {
    const paused = { t: 'paused', seat: 1, remainingMs: 90000, pausesLeft: [3, 2] };
    expect(parseServerMsg(JSON.stringify(paused))).toEqual(paused);
    expect(parseServerMsg(JSON.stringify({ t: 'chat', seat: 0, text: 'hi' }))).toEqual({ t: 'chat', seat: 0, text: 'hi' });
    expect(parseServerMsg(JSON.stringify({ t: 'cmdRefused' }))).toEqual({ t: 'cmdRefused' });
    expect(parseClientMsg(JSON.stringify({ t: 'cmdRefused' }))).toBeNull();
    const lobby = { t: 'lobby', config: null, seats: [], you: 0, map: 'tel_marum' };
    expect(parseServerMsg(JSON.stringify(lobby))).toEqual(lobby);
    expect(parseServerMsg(JSON.stringify({ t: 'ended', reason: 'surrender', seat: 1 }))).toEqual({ t: 'ended', reason: 'surrender', seat: 1 });
    expect(parseServerMsg(JSON.stringify({ t: 'ended', reason: 'boredom' }))).toBeNull();
  });
  it('a lobby carries the room\'s kit rule when it is brigade, and refuses a rule that is neither (per-seat kit)', () => {
    const lobby = { t: 'lobby', config: null, seats: [], you: 1, map: 'tel_marum', factions: ['kdf', 'kdf'], kit: 'brigade' };
    expect(parseServerMsg(JSON.stringify(lobby))).toEqual(lobby);
    expect(parseServerMsg(JSON.stringify({ ...lobby, kit: 'matched' }))).toEqual({ ...lobby, kit: 'matched' });
    expect(parseServerMsg(JSON.stringify({ ...lobby, kit: 'everything' }))).toBeNull();
    const older = { t: 'lobby', config: null, seats: [], you: 1, map: 'tel_marum', factions: ['kdf', 'kdf'] };
    expect(parseServerMsg(JSON.stringify(older))).toEqual(older);
  });
  it('a lobby carries the factions by seat when it has them, and refuses a malformed pair (2026-10-14)', () => {
    const lobby = { t: 'lobby', config: null, seats: [], you: 1, map: 'tel_marum', factions: ['sarim', 'kdf'] };
    expect(parseServerMsg(JSON.stringify(lobby))).toEqual(lobby);
    expect(parseServerMsg(JSON.stringify({ ...lobby, factions: ['sarim'] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ ...lobby, factions: ['sarim', 'rif'] }))).toBeNull();
  });

  it('refuses a lobby with no map, and malformed paused, chat and ended seats', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'lobby', config: null, seats: [], you: 0 }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'lobby', config: null, seats: [], you: 0, map: 3 }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'paused', seat: 2, remainingMs: 1, pausesLeft: [3, 3] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'paused', seat: 0, remainingMs: 1.5, pausesLeft: [3, 3] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'paused', seat: 0, remainingMs: 1, pausesLeft: [3] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'paused', seat: 0, remainingMs: 1, pausesLeft: [3, 'x'] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'chat', seat: 0, text: 5 }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'chat', seat: 3, text: 'hi' }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'ended', reason: 'surrender', seat: 5 }))).toBeNull();
  });
  it('keeps the client and server resume tags apart', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'paused', seat: 0, remainingMs: 1, pausesLeft: [3, 3] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'pause' }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'surrender' }))).toBeNull();
  });
});

describe('the room closes itself after the result (L-1, R-B26)', () => {
  it('parses over with a non-negative integer tick, and nothing else', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'over', tick: 0 }))).toEqual({ t: 'over', tick: 0 });
    expect(parseClientMsg(JSON.stringify({ t: 'over', tick: 1199 }))).toEqual({ t: 'over', tick: 1199 });
    expect(parseClientMsg(JSON.stringify({ t: 'over', tick: -1 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'over', tick: 1.5 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'over', tick: '19' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'over' }))).toBeNull();
  });
  it('parses ended over, and the server never takes over from a client', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'ended', reason: 'over' }))).toEqual({ t: 'ended', reason: 'over' });
    expect(parseServerMsg(JSON.stringify({ t: 'over', tick: 19 }))).toBeNull();
  });
  it('closes two minutes after the result', () => {
    expect(OVER_CLOSE_MS).toBe(120_000);
  });

  it('parses dropped, back and ended forfeit, and refuses them malformed', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'dropped', seat: 1, remainingMs: 60_000 }))).toEqual({ t: 'dropped', seat: 1, remainingMs: 60_000 });
    expect(parseServerMsg(JSON.stringify({ t: 'dropped', seat: 2, remainingMs: 1 }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'dropped', seat: 1, remainingMs: -1 }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'dropped', seat: 1 }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'back', seat: 0 }))).toEqual({ t: 'back', seat: 0 });
    expect(parseServerMsg(JSON.stringify({ t: 'back' }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'ended', reason: 'forfeit', seat: 0 }))).toEqual({ t: 'ended', reason: 'forfeit', seat: 0 });
    expect(FORFEIT_MS).toBe(60_000);
  });
  it('endingLoser: a surrender, a leave and a forfeit name who lost; anything else, or no seat, names nobody', () => {
    expect(endingLoser('surrender', 1)).toBe(1);
    expect(endingLoser('left', 0)).toBe(0);
    expect(endingLoser('forfeit', 1)).toBe(1);
    expect(endingLoser('left', undefined)).toBeNull();
    for (const r of ['void', 'expired', 'over']) expect(endingLoser(r, 0)).toBeNull();
  });
});

describe('N4a: advisor, done, advisors and the round stall', () => {
  const MOVE = { kind: 'move', ids: [1], x: 3, y: 4 };
  it('parseClientMsg returns an advisor message CLEANED, and refuses one it cannot clean', () => {
    const raw = JSON.stringify({ t: 'advisor', a: { kind: 'proposal', id: 2, cmd: { ...MOVE, pad: 'x'.repeat(5000) }, note: 'go' } });
    expect(raw.length).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(parseClientMsg(raw)).toBeNull();   // over the cap, whatever it carries
    const small = JSON.stringify({ t: 'advisor', a: { kind: 'proposal', id: 2, cmd: { ...MOVE, pad: 'x'.repeat(100) }, note: 'go‮' } });
    expect(parseClientMsg(small)).toEqual({ t: 'advisor', a: { kind: 'proposal', id: 2, cmd: MOVE, note: 'go' } });
    expect(parseClientMsg(JSON.stringify({ t: 'advisor', a: { kind: 'ping', x: 256, y: 0 } }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'advisor' }))).toBeNull();
  });
  it('done carries a round that is a non-negative integer', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'done', round: 4 }))).toEqual({ t: 'done', round: 4 });
    expect(parseClientMsg(JSON.stringify({ t: 'done', round: 0 }))).toEqual({ t: 'done', round: 0 });
    expect(parseClientMsg(JSON.stringify({ t: 'done', round: -1 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'done', round: 1.5 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'done' }))).toBeNull();
  });
  it('parseServerMsg: advisor relays a cleaned message and its sender', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'advisor', from: 'advisor', a: { kind: 'text', text: 'hi‮' } })))
      .toEqual({ t: 'advisor', from: 'advisor', a: { kind: 'text', text: 'hi' } });
    expect(parseServerMsg(JSON.stringify({ t: 'advisor', from: 'human', a: { kind: 'accept', id: 1 } })))
      .toEqual({ t: 'advisor', from: 'human', a: { kind: 'accept', id: 1 } });
    expect(parseServerMsg(JSON.stringify({ t: 'advisor', from: 'bot', a: { kind: 'accept', id: 1 } }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'advisor', from: 'human', a: { kind: 'accept', id: 1.5 } }))).toBeNull();
  });
  it('parseServerMsg: advisors accepts null or a scope per seat, and refuses the rest', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'advisors', present: [null, 'assist'] }))).toEqual({ t: 'advisors', present: [null, 'assist'] });
    expect(parseServerMsg(JSON.stringify({ t: 'advisors', present: ['advise', null] }))).toEqual({ t: 'advisors', present: ['advise', null] });
    expect(parseServerMsg(JSON.stringify({ t: 'advisors', present: ['command', null] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'advisors', present: [null] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'advisors', present: [null, null, null] }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ t: 'advisors' }))).toBeNull();
  });
  it('a stall with reason round parses; an unknown reason does not', () => {
    expect(parseServerMsg(JSON.stringify({ t: 'stall', reason: 'round', seat: 1 }))).toEqual({ t: 'stall', reason: 'round', seat: 1 });
    expect(parseServerMsg(JSON.stringify({ t: 'stall', reason: 'later', seat: 1 }))).toBeNull();
  });
});
