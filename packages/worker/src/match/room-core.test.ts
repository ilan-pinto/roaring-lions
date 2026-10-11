import { describe, it, expect } from 'vitest';
import type { MatchConfig } from '@lions/net';
import { createRoom, seatJoin, seatMessage, seatGone, clockTick, expire, STALL_BEHIND_TICKS, STALL_SILENT_MS, type RoomState, type Effect } from './room-core';

const CONFIG: MatchConfig = {
  matchId: 'm1', code: 'ABCDEF', seed: 7, map: 'beit_sahwan_outskirts', mode: 'sandbox',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p0', callsign: 'Host', kind: 'human' },
    { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p1', callsign: 'Guest', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
};
const mint = (): MatchConfig => CONFIG;
const sends = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { kind: 'send' }> => e.kind === 'send');
const frames = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { kind: 'frame' }> => e.kind === 'frame').map((e) => e.frame);

function running(): RoomState {
  const st = createRoom('ABCDEF', 'm1', 0);
  seatJoin(st, 0, 'p0', 'Host', 0);
  seatJoin(st, 1, 'p1', 'Guest', 0);
  seatMessage(st, 0, { t: 'ready' }, 0, mint);
  seatMessage(st, 1, { t: 'ready' }, 0, mint);
  return st;
}

describe('room-core', () => {
  it('starts when both seats are ready, and sends start with the config to both', () => {
    const st = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st, 0, 'p0', 'Host', 0);
    seatJoin(st, 1, 'p1', 'Guest', 0);
    seatMessage(st, 0, { t: 'ready' }, 0, mint);
    expect(st.status).toBe('lobby');
    const fx = seatMessage(st, 1, { t: 'ready' }, 0, mint);
    expect(st.status).toBe('running');
    expect(sends(fx).filter((s) => s.msg.t === 'start')).toHaveLength(1);
    expect(sends(fx).find((s) => s.msg.t === 'start')?.to).toBe('all');
  });

  it('emits one frame per clock tick with the pending commands stamped and ordered by seat then seq', () => {
    const st = running();
    seatMessage(st, 1, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [2] } }, 10, mint);
    seatMessage(st, 0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } }, 11, mint);
    const [f0] = frames(clockTick(st, 50));
    expect(f0.tick).toBe(0);
    expect(f0.cmds.map((c) => [c.seat, c.seq])).toEqual([[0, 0], [1, 0]]);
    const [f1] = frames(clockTick(st, 100));
    expect(f1).toEqual({ tick: 1, cmds: [] });
    expect(st.tick).toBe(2);
  });

  it('re-stamps a seat\'s seq from its own counter, so a client cannot forge order', () => {
    const st = running();
    seatMessage(st, 0, { t: 'cmd', seq: 99, cmd: { kind: 'halt', ids: [1] } }, 10, mint);
    seatMessage(st, 0, { t: 'cmd', seq: 5, cmd: { kind: 'halt', ids: [1] } }, 11, mint);
    const [f] = frames(clockTick(st, 50));
    expect(f.cmds.map((c) => c.seq)).toEqual([0, 1]);
  });

  it('caps a seat at 32 commands per frame', () => {
    const st = running();
    for (let i = 0; i < 40; i++) seatMessage(st, 0, { t: 'cmd', seq: i, cmd: { kind: 'halt', ids: [1] } }, 10, mint);
    const [f] = frames(clockTick(st, 50));
    expect(f.cmds).toHaveLength(32);
  });

  it('stalls when a seat falls 40 ticks behind its acks, and resumes on the ack', () => {
    const st = running();
    for (let t = 0; t < STALL_BEHIND_TICKS; t++) {
      clockTick(st, 50 * (t + 1));
      seatMessage(st, 0, { t: 'ack', tick: t }, 50 * (t + 1), mint);
    }
    const fx = clockTick(st, 50 * (STALL_BEHIND_TICKS + 1));
    expect(st.status).toBe('stalled');
    expect(frames(fx)).toHaveLength(0);
    expect(sends(fx).find((s) => s.msg.t === 'stall')?.msg).toEqual({ t: 'stall', reason: 'behind', seat: 1 });
    const back = seatMessage(st, 1, { t: 'ack', tick: STALL_BEHIND_TICKS - 1 }, 50 * (STALL_BEHIND_TICKS + 2), mint);
    expect(st.status).toBe('running');
    expect(sends(back).some((s) => s.msg.t === 'resume')).toBe(true);
  });

  it('stalls when a seat is silent for 2 s and when its socket is gone', () => {
    const st = running();
    clockTick(st, 50);
    seatMessage(st, 0, { t: 'ack', tick: 0 }, 50, mint);
    seatMessage(st, 1, { t: 'ack', tick: 0 }, 50, mint);
    const fx = clockTick(st, 50 + STALL_SILENT_MS + 1);
    expect(st.status).toBe('stalled');
    expect(sends(fx).find((s) => s.msg.t === 'stall')?.msg).toMatchObject({ reason: 'gone' });
    const st2 = running();
    seatGone(st2, 1, 100);
    const fx2 = clockTick(st2, 150);
    expect(st2.status).toBe('stalled');
    expect(frames(fx2)).toHaveLength(0);
  });

  it('compares hashes per tick and voids the match on a mismatch', () => {
    const st = running();
    let fx = seatMessage(st, 0, { t: 'hash', tick: 20, h: 1 }, 0, mint);
    expect(sends(fx)).toHaveLength(0);
    fx = seatMessage(st, 1, { t: 'hash', tick: 20, h: 1 }, 0, mint);
    expect(sends(fx).map((s) => s.msg)).toEqual([{ t: 'hashOk', tick: 20 }]);
    seatMessage(st, 0, { t: 'hash', tick: 40, h: 1 }, 0, mint);
    fx = seatMessage(st, 1, { t: 'hash', tick: 40, h: 2 }, 0, mint);
    expect(st.status).toBe('ended');
    expect(st.endedReason).toBe('void');
    expect(sends(fx).find((s) => s.msg.t === 'desync')?.msg).toEqual({ t: 'desync', tick: 40, hashes: [1, 2] });
  });

  it('a second hello for a seat replaces it and answers with the log; a full room refuses a third player', () => {
    const st = running();
    const collected = [...frames(clockTick(st, 50)), ...frames(clockTick(st, 100))];
    const fx = seatJoin(st, 1, 'p1', 'Guest', 200, () => collected);
    expect(fx).toContainEqual({ kind: 'close', seat: 1 });
    const log = sends(fx).find((s) => s.msg.t === 'log')?.msg;
    expect(log && log.t === 'log' ? log.frames.map((f) => f.tick) : null).toEqual([0, 1]);
    const st2 = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st2, 0, 'p0', 'Host', 0);
    seatJoin(st2, 1, 'p1', 'Guest', 0);
    expect(st2.seats.every((s) => s !== null)).toBe(true);
  });

  it('expires six hours after creation', () => {
    const st = running();
    const fx = clockTick(st, 6 * 3600 * 1000 + 1);
    expect(st.status).toBe('ended');
    expect(sends(fx).find((s) => s.msg.t === 'ended')?.msg).toEqual({ t: 'ended', reason: 'expired' });
  });

  it('expires a lobby too, once, with no clock running (expire, run from every DO handler)', () => {
    const st = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st, 0, 'p0', 'Host', 0);
    expect(expire(st, 6 * 3600 * 1000)).toEqual([]);
    expect(st.status).toBe('lobby');
    expect(sends(expire(st, 6 * 3600 * 1000 + 1)).map((s) => s.msg)).toEqual([{ t: 'ended', reason: 'expired' }]);
    expect(st.status).toBe('ended');
    expect(expire(st, 7 * 3600 * 1000)).toEqual([]);
  });

  it('the persisted tick survives a simulated eviction: a new clock continues from it', () => {
    const st = running();
    clockTick(st, 50);
    clockTick(st, 100);
    const revived: RoomState = JSON.parse(JSON.stringify(st));
    const [f] = frames(clockTick(revived, 150));
    expect(f.tick).toBe(2);
  });

  it('does not carry lobby silence into the match: a late second ready still gets a frame, not a stall', () => {
    const st = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st, 0, 'p0', 'Host', 0);
    seatJoin(st, 1, 'p1', 'Guest', 0);
    seatMessage(st, 0, { t: 'ready' }, 0, mint);
    seatMessage(st, 1, { t: 'ready' }, 10_000, mint);
    const fx = clockTick(st, 10_050);
    expect(st.status).toBe('running');
    expect(sends(fx).some((s) => s.msg.t === 'stall')).toBe(false);
    expect(frames(fx)).toHaveLength(1);
  });

  it('a stall longer than 2 s does not deadlock: the healthy seat is not judged silent, and a reconnect resumes', () => {
    const st = running();
    clockTick(st, 50);
    seatGone(st, 1, 100);
    clockTick(st, 150);
    expect(st.stall).toEqual({ reason: 'gone', seat: 1 });
    const mid = clockTick(st, 5_000);   // seat 0 has sent nothing for 5 s: it is waiting, not gone
    expect(st.status).toBe('stalled');
    expect(st.stall).toEqual({ reason: 'gone', seat: 1 });
    expect(sends(mid)).toHaveLength(0);
    const fx = seatJoin(st, 1, 'p1', 'Guest', 5_100, () => []);
    expect(sends(fx).some((s) => s.msg.t === 'resume')).toBe(true);
    expect(st.status).toBe('running');
    seatMessage(st, 1, { t: 'ack', tick: 0 }, 5_110, mint);
    expect(st.status).toBe('running');
    expect(frames(clockTick(st, 5_150))).toHaveLength(1);   // seat 0's silence was reset on resume
  });

  it('re-announces a stall whose cause changes, and says nothing while it does not', () => {
    const st = running();
    clockTick(st, 50);
    seatGone(st, 1, 100);
    expect(st.stall).toEqual({ reason: 'gone', seat: 1 });
    expect(sends(clockTick(st, 150))).toHaveLength(0);
    const fx = seatGone(st, 0, 200);
    expect(sends(fx).map((s) => s.msg)).toEqual([{ t: 'stall', reason: 'gone', seat: 0 }]);
    expect(st.stall).toEqual({ reason: 'gone', seat: 0 });
  });

  it('keeps the hash table bounded: no replays, no forged ticks, at most 16 open entries', () => {
    const st = running();
    for (const tick of [20, 40]) for (const seat of [0, 1] as const) seatMessage(st, seat, { t: 'hash', tick, h: 1 }, 0, mint);
    for (const tick of [20, 40]) for (const seat of [0, 1] as const) seatMessage(st, seat, { t: 'hash', tick, h: 1 }, 0, mint);   // replays
    // a replay of a compared tick with a different value must not re-open the comparison and void the match
    seatMessage(st, 0, { t: 'hash', tick: 20, h: 1 }, 0, mint);
    const replayed = seatMessage(st, 1, { t: 'hash', tick: 20, h: 2 }, 0, mint);
    expect(replayed).toEqual([]);
    expect(st.status).toBe('running');
    seatMessage(st, 0, { t: 'hash', tick: 2_000_000_000, h: 1 }, 0, mint);
    seatMessage(st, 0, { t: 'hash', tick: -7, h: 1 }, 0, mint);
    for (let i = 0; i < 20; i++) seatMessage(st, 0, { t: 'hash', tick: 100 + i, h: 1 }, 0, mint);
    const open = Object.keys(st.hashes).map(Number);
    expect(open.length).toBeLessThanOrEqual(16);
    expect(open.every((t) => t > st.lastHashTick && t >= 0)).toBe(true);
    expect(st.lastHashTick).toBe(40);
  });

  it('a flood of forged far-future hash ticks cannot crowd out an honest comparison', () => {
    const st = running();
    for (let i = 0; i < 16; i++) seatMessage(st, 0, { t: 'hash', tick: 1_000_000 + i * 20, h: 1 }, 0, mint);
    seatMessage(st, 0, { t: 'hash', tick: 20, h: 1 }, 0, mint);
    const fx = seatMessage(st, 1, { t: 'hash', tick: 20, h: 2 }, 0, mint);
    expect(sends(fx).map((s) => s.msg)).toEqual([{ t: 'desync', tick: 20, hashes: [1, 2] }]);
    expect(st.status).toBe('ended');
  });

  it('ignores a hash in the lobby', () => {
    const st = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st, 0, 'p0', 'Host', 0);
    seatMessage(st, 0, { t: 'hash', tick: 20, h: 1 }, 0, mint);
    expect(st.hashes).toEqual({});
  });
});
