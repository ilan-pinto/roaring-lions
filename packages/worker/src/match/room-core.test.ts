import { describe, it, expect } from 'vitest';
import { OVER_CLOSE_MS, type MatchConfig } from '@lions/net';
import { createRoom, logParts, seatJoin, seatMessage, seatGone, clockTick, closeIfDue, expire, persistKey, revive, endedMsg, ACK_EVERY, STALL_BEHIND_TICKS, STALL_SILENT_MS, MAX_LOG_CMD_CHARS, type RoomState, type Effect } from './room-core';

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

  it('#559 F2: a frame carries at most 4 of a seat\'s commands; up to 12 wait for the next frames, and the rest are dropped', () => {
    const st = running();
    for (let i = 0; i < 40; i++) seatMessage(st, 0, { t: 'cmd', seq: i, cmd: { kind: 'halt', ids: [i] } }, 10, mint);
    seatMessage(st, 1, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [99] } }, 10, mint);
    const per = [1, 2, 3, 4].map((k) => frames(clockTick(st, 50 * k))[0].cmds);
    expect(per.map((c) => c.filter((x) => x.seat === 0).length)).toEqual([4, 4, 4, 0]);
    expect(per[0].filter((x) => x.seat === 1)).toHaveLength(1);   // the other seat is not held up
    expect(per.flat().filter((x) => x.seat === 0).map((x) => (x.cmd as { ids: number[] }).ids[0])).toEqual([...Array(12).keys()]);
  });

  it('#559 F2: the heaviest honest burst -- a three-command right-click plus a shift-queued one -- runs whole, over two frames', () => {
    const st = running();
    const click = (append: boolean) => [
      { kind: 'demolish', ids: [1], structure: 0 }, { kind: 'garrison', ids: [2], structure: 0 },
      { kind: 'attackMove', ids: [3, 4, 5], x: 0, y: 0, append },
    ] as const;
    let seq = 0;
    for (const cmd of [...click(false), ...click(true)]) seatMessage(st, 0, { t: 'cmd', seq: seq++, cmd: { ...cmd, ids: [...cmd.ids] } }, 10, mint);
    const f0 = frames(clockTick(st, 50))[0].cmds;
    const f1 = frames(clockTick(st, 100))[0].cmds;
    expect([f0.length, f1.length]).toEqual([4, 2]);
  });

  it('#559 F2: a seat\'s budget is 20 commands at once and 20 a second after that', () => {
    const st = running();
    let accepted = 0;
    const send = (n: number, at: number) => {
      for (let i = 0; i < n; i++) {
        seatMessage(st, 0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } }, at, mint);
      }
      // drain everything queued so the pending cap is not what refuses
      for (let k = 0; k < 10; k++) accepted += frames(clockTick(st, at))[0]?.cmds.length ?? 0;
    };
    for (let i = 0; i < 3; i++) send(10, 10);   // 30 at one instant: 20 pass, minus what the pending cap held back
    expect(accepted).toBe(20);
    send(30, 1010);   // a second later: 20 more tokens
    expect(accepted).toBe(32);   // 12 of them: the pending cap holds 12 between drains
  });

  it('#559 H-1: past MAX_LOG_CMD_CHARS of stamped commands the match is void, and nothing more is minted', () => {
    const st = running();
    st.cmdChars = MAX_LOG_CMD_CHARS - 10;
    seatMessage(st, 0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1, 2, 3, 4, 5, 6] } }, 10, mint);
    const fx = clockTick(st, 50);
    expect(frames(fx)).toEqual([]);
    expect(sends(fx).map((s) => s.msg)).toContainEqual({ t: 'ended', reason: 'void' });
    expect(st).toMatchObject({ status: 'ended', endedReason: 'void' });
    expect(frames(clockTick(st, 100))).toEqual([]);
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

  it('a seat acking on the client cadence (ACK_EVERY, bufferTicks behind) never stalls behind', () => {
    const st = running();
    let ran = -1;   // the newest tick each seat has run
    for (let t = 0; t < 400; t++) {
      const fx = clockTick(st, 50 * (t + 1));
      expect(sends(fx).filter((s) => s.msg.t === 'stall')).toEqual([]);
      // Each seat runs what the clock lets it: up to newest - bufferTicks.
      while (ran < st.tick - 1 - CONFIG.bufferTicks) {
        ran++;
        if (ran % ACK_EVERY === ACK_EVERY - 1) for (const seat of [0, 1] as const) seatMessage(st, seat, { t: 'ack', tick: ran }, 50 * (t + 1), mint);
      }
    }
    expect(st.status).toBe('running');
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
    st.tick = 1000;   // the ticks hashed below have been minted
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
    st.tick = 1000;
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
    st.tick = 1000;
    for (let i = 0; i < 16; i++) seatMessage(st, 0, { t: 'hash', tick: 1_000_000 + i * 20, h: 1 }, 0, mint);
    seatMessage(st, 0, { t: 'hash', tick: 20, h: 1 }, 0, mint);
    const fx = seatMessage(st, 1, { t: 'hash', tick: 20, h: 2 }, 0, mint);
    expect(sends(fx).map((s) => s.msg)).toEqual([{ t: 'desync', tick: 20, hashes: [1, 2] }]);
    expect(st.status).toBe('ended');
  });

  it('#559 M-2/L-2: a hash for a tick the room has not minted yet is ignored, so no seat can void a match with one', () => {
    const st = running();
    for (let t = 0; t < 20; t++) clockTick(st, 50 * (t + 1));
    expect(st.tick).toBe(20);
    for (const tick of [20, 999_999]) {
      seatMessage(st, 0, { t: 'hash', tick, h: 1 }, 1000, mint);
      expect(sends(seatMessage(st, 1, { t: 'hash', tick, h: 2 }, 1000, mint))).toEqual([]);
    }
    expect(st.hashes).toEqual({});
    expect(st.status).toBe('running');
    // The last minted tick is still compared.
    seatMessage(st, 0, { t: 'hash', tick: 19, h: 1 }, 1000, mint);
    expect(sends(seatMessage(st, 1, { t: 'hash', tick: 19, h: 1 }, 1000, mint)).map((x) => x.msg)).toEqual([{ t: 'hashOk', tick: 19 }]);
  });

  it('ignores a hash in the lobby', () => {
    const st = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st, 0, 'p0', 'Host', 0);
    seatMessage(st, 0, { t: 'hash', tick: 20, h: 1 }, 0, mint);
    expect(st.hashes).toEqual({});
  });

  it('persistKey moves with the lifecycle and never with per-tick traffic or a stall', () => {
    const st = running();
    const key = persistKey(st);
    clockTick(st, 50);
    seatMessage(st, 0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } }, 60, mint);
    seatMessage(st, 0, { t: 'ack', tick: 0 }, 60, mint);
    seatMessage(st, 0, { t: 'hash', tick: 0, h: 1 }, 60, mint);
    expect(persistKey(st)).toBe(key);
    // A behind or silent stall flaps with a slow seat's acks: not lifecycle (R37).
    st.status = 'stalled';
    st.stall = { reason: 'behind', seat: 1 };
    expect(persistKey(st)).toBe(key);
    st.stall = { reason: 'gone', seat: 0 };
    expect(persistKey(st)).toBe(key);
    const lifecycle: [string, (s: RoomState) => void][] = [
      ['status', (s) => { s.status = 'ended'; }],
      ['lobby', (s) => { s.status = 'lobby'; }],
      ['ended reason', (s) => { s.endedReason = 'left'; }],
      ['config', (s) => { s.config = null; }],
      ['connected', (s) => { if (s.seats[1]) s.seats[1].connected = false; }],
      ['ready', (s) => { if (s.seats[0]) s.seats[0].ready = false; }],
      ['callsign', (s) => { if (s.seats[0]) s.seats[0].callsign = 'Other'; }],
      ['player', (s) => { if (s.seats[1]) s.seats[1].player = 'p9'; }],
      ['seat', (s) => { s.seats[1] = null; }],
    ];
    const lifecycleKey = persistKey(st);
    for (const [name, change] of lifecycle) {
      const copy = structuredClone(st);
      change(copy);
      expect(persistKey(copy), name).not.toBe(lifecycleKey);
    }
  });

  it('revive continues at the persisted frames, re-earns acks and silence, and never stamps a command twice', () => {
    const st = running();
    seatMessage(st, 0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } }, 0, mint);
    // Stored while tick 5 was next: the command went into frame 5, which a closed batch holds.
    st.tick = 5;
    revive(st, 20, 9000);
    expect(st.tick).toBe(20);
    expect(st.pending).toEqual([]);
    expect(st.seats.map((s) => [s?.lastAck, s?.lastSeenMs])).toEqual([[19, 9000], [19, 9000]]);
    expect(clockTick(st, 9050).map((e) => e.kind)).toEqual(['frame', 'send']);   // no stall
    // Frames persisted exactly up to the state's tick: its pending commands were never stamped.
    const fresh = running();
    seatMessage(fresh, 1, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [2] } }, 0, mint);
    fresh.tick = 7;
    revive(fresh, 7, 0);
    expect(fresh.tick).toBe(7);
    expect(fresh.pending).toHaveLength(1);
  });
});

describe('the lobby carries the room\'s map (N1b task 1)', () => {
  it('lobbyMsg reports the map createRoom was given, and a room made without one reports ""', () => {
    const st = createRoom('ABCDEF', 'm1', 0, 'tel_marum');
    const lobby = sends(seatJoin(st, 0, 'p0', 'Host', 0)).map((e) => e.msg);
    expect(lobby).toEqual([expect.objectContaining({ t: 'lobby', map: 'tel_marum' })]);
    expect(createRoom('ABCDEF', 'm1', 0).map).toBe('');
  });
  it('ignores pause, resume and surrender in the lobby (chat has rules since task 2)', () => {
    const st = createRoom('ABCDEF', 'm1', 0, 'tel_marum');
    seatJoin(st, 0, 'p0', 'Host', 0);
    for (const m of [{ t: 'pause' }, { t: 'resume' }, { t: 'surrender' }] as const) {
      expect(seatMessage(st, 0, m, 1, mint)).toEqual([]);
    }
    expect(st.status).toBe('lobby');
    expect(st.pausesLeft).toEqual([3, 3]);
  });
});

describe('pause (N1b task 2)', () => {
  it('stops frames, tells both seats who and for how long, and spends one pause', () => {
    const st = running();
    const fx = seatMessage(st, 1, { t: 'pause' }, 1000, mint);
    expect(sends(fx).map((s) => s.msg)).toEqual([{ t: 'paused', seat: 1, remainingMs: 90000, pausesLeft: [3, 2] }]);
    expect(sends(fx).map((s) => s.to)).toEqual(['all']);
    expect(frames(clockTick(st, 1050))).toHaveLength(0);
  });
  it('only the pauser resumes early; the other seat\'s resume is ignored', () => {
    const st = running();
    seatMessage(st, 1, { t: 'pause' }, 1000, mint);
    expect(sends(seatMessage(st, 0, { t: 'resume' }, 2000, mint))).toEqual([]);
    expect(sends(seatMessage(st, 1, { t: 'resume' }, 2000, mint)).map((s) => s.msg)).toEqual([{ t: 'resume' }]);
    expect(frames(clockTick(st, 2050))).toHaveLength(1);
  });
  it('ends by itself at 90 s', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    expect(frames(clockTick(st, 1000 + 89_999))).toHaveLength(0);
    const fx = clockTick(st, 1000 + 90_000);
    expect(sends(fx).some((s) => s.msg.t === 'resume')).toBe(true);
    expect(frames(fx)).toHaveLength(1);
  });
  it('refuses a fourth pause, and a pause while paused', () => {
    const st = running();
    for (let i = 0; i < 3; i++) {
      seatMessage(st, 0, { t: 'pause' }, 1000 * i, mint);
      seatMessage(st, 0, { t: 'resume' }, 1000 * i + 500, mint);
    }
    expect(sends(seatMessage(st, 0, { t: 'pause' }, 9000, mint))).toEqual([]);
    seatMessage(st, 1, { t: 'pause' }, 9100, mint);
    expect(sends(seatMessage(st, 1, { t: 'pause' }, 9200, mint))).toEqual([]);
  });
  it('a pause is not silence: resuming does not stall the room as gone', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    const fx = seatMessage(st, 0, { t: 'resume' }, 60_000, mint);
    expect(sends(fx).some((s) => s.msg.t === 'stall')).toBe(false);
    expect(frames(clockTick(st, 60_050))).toHaveLength(1);
  });
  it('a pause outranks every stall rule: a seat going or acking during it changes nothing', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    expect(sends(seatGone(st, 1, 1100))).toEqual([]);
    expect(sends(seatMessage(st, 0, { t: 'ack', tick: 0 }, 1200, mint))).toEqual([]);
    expect(st.status).toBe('stalled');
    expect(frames(clockTick(st, 1250))).toHaveLength(0);
    // The gone seat is still gone when the pause ends: resume, then the stall it really has.
    const fx = sends(seatMessage(st, 0, { t: 'resume' }, 2000, mint)).map((s) => s.msg);
    expect(fx).toEqual([{ t: 'resume' }, { t: 'stall', reason: 'gone', seat: 1 }]);
  });
  it('a resume after the match ended does not bring it back to life', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    seatMessage(st, 1, { t: 'surrender' }, 1100, mint);
    expect(sends(seatMessage(st, 0, { t: 'resume' }, 1200, mint))).toEqual([]);
    expect(st.status).toBe('ended');
    expect(clockTick(st, 1250)).toEqual([]);
  });
  it('a seat rejoining during a pause is told about it, with the time left', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    seatGone(st, 1, 5000);
    const fx = sends(seatJoin(st, 1, 'p1', 'Guest', 31_000, () => [])).map((s) => [s.to, s.msg.t]);
    expect(fx).toEqual([[1, 'log'], [1, 'paused']]);
    const paused = sends(seatJoin(st, 1, 'p1', 'Guest', 31_000)).find((s) => s.msg.t === 'paused');
    expect(paused?.msg).toEqual({ t: 'paused', seat: 0, remainingMs: 60_000, pausesLeft: [2, 3] });
    // Past the deadline the figure never goes negative.
    const late = sends(seatJoin(st, 1, 'p1', 'Guest', 500_000)).find((s) => s.msg.t === 'paused');
    expect(late?.msg).toMatchObject({ remainingMs: 0 });
  });
  it('a room with no pause sends a rejoiner only the log', () => {
    const st = running();
    expect(sends(seatJoin(st, 1, 'p1', 'Guest', 10)).map((s) => s.msg.t)).toEqual(['log']);
  });
});

describe('orders wait while the match is paused, for both seats (L-2, R-B27)', () => {
  const halt = (id: number) => ({ kind: 'halt' as const, ids: [id] });

  it('a cmd from either seat during a pause is refused: never pending, never in any frame, including the first after resume', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    // The pauser and the other seat alike.
    const refused = (seat: 0 | 1) => [{ kind: 'send', to: seat, msg: { t: 'cmdRefused' } }];
    expect(seatMessage(st, 0, { t: 'cmd', seq: 0, cmd: halt(1) }, 1100, mint)).toEqual(refused(0));
    expect(seatMessage(st, 1, { t: 'cmd', seq: 0, cmd: halt(2) }, 1200, mint)).toEqual(refused(1));
    expect(st.pending).toEqual([]);
    expect(frames(clockTick(st, 1250))).toHaveLength(0);
    seatMessage(st, 0, { t: 'resume' }, 2000, mint);
    const fx = clockTick(st, 2050);
    expect(frames(fx)).toEqual([{ tick: 0, cmds: [] }]);
    expect(frames(clockTick(st, 2100))).toEqual([{ tick: 1, cmds: [] }]);
  });

  it('a cmd already in flight when the pause starts reaches the room after it began, and is refused', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    // Sent by seat 1 before it heard `paused`; arrives 1 ms after the pause.
    // The sender is told, and only the sender: that is the one signal its client has.
    expect(seatMessage(st, 1, { t: 'cmd', seq: 0, cmd: halt(7) }, 1001, mint)).toEqual([{ kind: 'send', to: 1, msg: { t: 'cmdRefused' } }]);
    seatMessage(st, 0, { t: 'resume' }, 1500, mint);
    expect(frames(clockTick(st, 1550))[0].cmds).toEqual([]);
  });

  it('a cmd accepted before the pause still runs; only what arrives during it is refused', () => {
    const st = running();
    seatMessage(st, 1, { t: 'cmd', seq: 0, cmd: halt(2) }, 990, mint);
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    seatMessage(st, 1, { t: 'cmd', seq: 1, cmd: halt(3) }, 1010, mint);
    seatMessage(st, 0, { t: 'resume' }, 1500, mint);
    const [f] = frames(clockTick(st, 1550));
    expect(f.cmds.map((c) => c.cmd)).toEqual([halt(2)]);
  });

  it('a cmd after the resume is accepted, and a refusal takes no seq (the seat\'s stamped seqs stay contiguous)', () => {
    const st = running();
    seatMessage(st, 1, { t: 'cmd', seq: 0, cmd: halt(2) }, 10, mint);
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    seatMessage(st, 1, { t: 'cmd', seq: 1, cmd: halt(3) }, 1100, mint);
    seatMessage(st, 0, { t: 'resume' }, 2000, mint);
    clockTick(st, 2050);   // the pre-pause cmd's frame
    seatMessage(st, 1, { t: 'cmd', seq: 2, cmd: halt(4) }, 2060, mint);
    seatMessage(st, 0, { t: 'cmd', seq: 0, cmd: halt(1) }, 2061, mint);
    const [f] = frames(clockTick(st, 2100));
    // A refused cmd takes no number: seat 1's second accepted cmd is its second stamped (seq 1), seat 0's first is 0.
    expect(f.cmds.map((c) => [c.seat, c.seq, c.cmd])).toEqual([[0, 0, halt(1)], [1, 1, halt(4)]]);
  });

  it('the 90 s timeout ends the refusal too: a cmd just before the deadline is refused, one after is accepted', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    seatMessage(st, 1, { t: 'cmd', seq: 0, cmd: halt(2) }, 1000 + 89_999, mint);
    const fx = clockTick(st, 1000 + 90_000);
    expect(frames(fx)[0].cmds).toEqual([]);
    seatMessage(st, 1, { t: 'cmd', seq: 1, cmd: halt(3) }, 1000 + 90_010, mint);
    expect(frames(clockTick(st, 1000 + 90_050))[0].cmds.map((c) => c.cmd)).toEqual([halt(3)]);
  });

  it('only a pause refuses: a stall of another kind still takes a seat\'s cmd, as before', () => {
    const st = running();
    seatGone(st, 1, 100);
    expect(st.status).toBe('stalled');
    expect(st.pause).toBeNull();
    seatMessage(st, 0, { t: 'cmd', seq: 0, cmd: halt(1) }, 200, mint);
    expect(st.pending).toHaveLength(1);
  });
});

describe('surrender (N1b task 2)', () => {
  it('ends the match with the surrendering seat named', () => {
    const st = running();
    const fx = seatMessage(st, 1, { t: 'surrender' }, 1000, mint);
    expect(st.status).toBe('ended');
    expect(st.endedReason).toBe('surrender');
    expect(st.surrendered).toBe(1);
    expect(sends(fx).map((s) => s.msg)).toEqual([{ t: 'ended', reason: 'surrender', seat: 1 }]);
    expect(clockTick(st, 1050)).toEqual([]);
  });
  it('works through a stall and a pause, and a second surrender is ignored', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    expect(sends(seatMessage(st, 1, { t: 'surrender' }, 1100, mint))).toHaveLength(1);
    expect(sends(seatMessage(st, 0, { t: 'surrender' }, 1200, mint))).toEqual([]);
    expect(st.surrendered).toBe(1);
  });
  it('endedMsg names the seat for a surrender, and only then', () => {
    const st = running();
    seatMessage(st, 0, { t: 'surrender' }, 1000, mint);
    expect(endedMsg(st)).toEqual({ t: 'ended', reason: 'surrender', seat: 0 });
    const left = running();
    seatMessage(left, 0, { t: 'bye' }, 1000, mint);
    expect(endedMsg(left)).toEqual({ t: 'ended', reason: 'left' });
    expect(endedMsg(running())).toEqual({ t: 'ended', reason: 'expired' });
  });
});

describe('chat (N1b task 2)', () => {
  it('relays trimmed, control-free text to both seats', () => {
    const st = running();
    const fx = seatMessage(st, 0, { t: 'chat', text: '  hi\u0007 there \n ' }, 1000, mint);
    expect(sends(fx).map((s) => [s.to, s.msg])).toEqual([['all', { t: 'chat', seat: 0, text: 'hi there' }]]);
  });
  it('drops an empty message and one sent within 500 ms of the last', () => {
    const st = running();
    expect(sends(seatMessage(st, 0, { t: 'chat', text: '   ' }, 1000, mint))).toEqual([]);
    seatMessage(st, 0, { t: 'chat', text: 'a' }, 2000, mint);
    expect(sends(seatMessage(st, 0, { t: 'chat', text: 'b' }, 2400, mint))).toEqual([]);
    expect(sends(seatMessage(st, 0, { t: 'chat', text: 'c' }, 2600, mint))).toHaveLength(1);
  });
  it('rate-limits each seat on its own, and the first message is never limited', () => {
    const st = running();
    expect(sends(seatMessage(st, 0, { t: 'chat', text: 'a' }, 0, mint))).toHaveLength(1);
    expect(sends(seatMessage(st, 1, { t: 'chat', text: 'b' }, 100, mint))).toHaveLength(1);
  });
  it('caps what it relays at 280 characters', () => {
    const st = running();
    const fx = sends(seatMessage(st, 0, { t: 'chat', text: 'x'.repeat(400) }, 1000, mint));
    expect((fx[0]?.msg as { text: string }).text).toHaveLength(280);
  });
  it('works in the lobby too, and not once the match has ended', () => {
    const st = createRoom('ABCDEF', 'm1', 0);
    seatJoin(st, 0, 'p0', 'Host', 0);
    expect(sends(seatMessage(st, 0, { t: 'chat', text: 'hello' }, 10, mint))).toHaveLength(1);
    const over = running();
    seatMessage(over, 0, { t: 'bye' }, 10, mint);
    expect(sends(seatMessage(over, 1, { t: 'chat', text: 'hello' }, 2000, mint))).toEqual([]);
  });
});

describe('what pause, surrender and chat persist (N1b task 2 row budget)', () => {
  it('pause start, pause end and surrender move the persist key; chat, paused clock ticks and a spent-nothing resume do not', () => {
    const st = running();
    const k0 = persistKey(st);
    seatMessage(st, 0, { t: 'chat', text: 'hi' }, 100, mint);
    expect(persistKey(st)).toBe(k0);
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    const k1 = persistKey(st);
    expect(k1).not.toBe(k0);
    for (let t = 1050; t < 5000; t += 50) clockTick(st, t);
    seatMessage(st, 1, { t: 'chat', text: 'hi' }, 3000, mint);
    expect(persistKey(st)).toBe(k1);
    seatMessage(st, 0, { t: 'resume' }, 6000, mint);
    const k2 = persistKey(st);
    expect(k2).not.toBe(k1);
    expect(k2).not.toBe(k0);   // a pause is spent for good
    seatMessage(st, 1, { t: 'surrender' }, 7000, mint);
    expect(persistKey(st)).not.toBe(k2);
    // Two surrenders of different seats are different rooms.
    const a = running(); const b = running();
    seatMessage(a, 0, { t: 'surrender' }, 1, mint);
    seatMessage(b, 1, { t: 'surrender' }, 1, mint);
    expect(persistKey(a)).not.toBe(persistKey(b));
  });
});

describe('a room persisted before N1b (N1b task 2)', () => {
  it('revive defaults the new fields, so frames flow and a pause works', () => {
    const st = running();
    const legacy: Record<string, unknown> = JSON.parse(JSON.stringify(st));
    for (const k of ['pause', 'pausesLeft', 'lastChatMs', 'surrendered', 'map']) delete legacy[k];
    const old = legacy as unknown as RoomState;
    revive(old, 4, 9000);
    expect(old.pause).toBeNull();
    expect(old.pausesLeft).toEqual([3, 3]);
    expect(old.lastChatMs).toEqual([-1, -1]);
    expect(old.surrendered).toBeNull();
    expect(old.map).toBe('');
    expect(frames(clockTick(old, 9050))).toHaveLength(1);
    expect(sends(seatMessage(old, 0, { t: 'pause' }, 9100, mint)).map((s) => s.msg)).toEqual([{ t: 'paused', seat: 0, remainingMs: 90000, pausesLeft: [2, 3] }]);
    expect(sends(seatMessage(old, 0, { t: 'chat', text: 'hi' }, 9200, mint))).toHaveLength(1);
  });
  it('revive leaves a persisted pause and its deadline alone', () => {
    const st = running();
    seatMessage(st, 0, { t: 'pause' }, 1000, mint);
    const revived: RoomState = JSON.parse(JSON.stringify(st));
    revive(revived, 0, 20_000);
    expect(revived.pause).toEqual({ seat: 0, untilMs: 91_000 });
    expect(frames(clockTick(revived, 20_050))).toHaveLength(0);
    expect(frames(clockTick(revived, 91_000))).toHaveLength(1);
  });
});

describe('the room closes itself 2 minutes after the result (L-1, R-B26)', () => {
  /** A running room that has minted frames past the result tick (399): a report names a tick it sent. */
  function minted(next = 420): RoomState {
    const st = running();
    st.tick = next;
    return st;
  }
  /** Clock ticks every 50 ms over [from, to): the first tick that ends the room, or null. */
  function firstEnding(st: RoomState, from: number, to: number): { at: number; fx: Effect[] } | null {
    for (let t = from; t < to; t += 50) {
      const fx = clockTick(st, t);
      if (st.status === 'ended') return { at: t, fx };
    }
    return null;
  }
  const closing: Effect[] = [
    { kind: 'send', to: 'all', msg: { t: 'ended', reason: 'over' } },
    { kind: 'shut', seat: 0 },
    { kind: 'shut', seat: 1 },
  ];

  it('both seats report the same tick: the close is armed at the second report and fires at +120 s exactly, not a tick before', () => {
    const st = minted();
    expect(seatMessage(st, 0, { t: 'over', tick: 399 }, 1000, mint)).toEqual([]);
    expect(st.over).toEqual([399, -1]);
    expect(st.closeAtMs).toBeNull();   // one report, the other seat still here: not yet
    expect(seatMessage(st, 1, { t: 'over', tick: 399 }, 1500, mint)).toEqual([]);
    expect(st.closeAtMs).toBe(1500 + OVER_CLOSE_MS);
    const end = firstEnding(st, 1550, 1500 + OVER_CLOSE_MS + 1000);
    expect(end?.at).toBe(1500 + OVER_CLOSE_MS);
    expect(end?.fx).toEqual(closing);
    expect(st.endedReason).toBe('over');
    expect(endedMsg(st)).toEqual({ t: 'ended', reason: 'over' });   // what a late hello is told
    expect(clockTick(st, 1500 + OVER_CLOSE_MS + 50)).toEqual([]);   // ended: the clock has nothing more to do
  });

  it('one seat reports while the other is gone: armed at once, and a rejoin does not disarm it', () => {
    const st = minted();
    seatGone(st, 1, 900);
    seatMessage(st, 0, { t: 'over', tick: 399 }, 1000, mint);
    expect(st.closeAtMs).toBe(1000 + OVER_CLOSE_MS);
    seatJoin(st, 1, 'p1', 'Guest', 5000);
    seatMessage(st, 1, { t: 'over', tick: 399 }, 6000, mint);
    expect(st.closeAtMs).toBe(1000 + OVER_CLOSE_MS);   // armed once, never pushed back
    expect(firstEnding(st, 6050, 200_000)?.at).toBe(1000 + OVER_CLOSE_MS);
  });

  it('one seat reports, then the other goes without reporting: armed when it goes', () => {
    const st = minted();
    seatMessage(st, 0, { t: 'over', tick: 399 }, 1000, mint);
    expect(st.closeAtMs).toBeNull();
    seatGone(st, 1, 3000);
    expect(st.closeAtMs).toBe(3000 + OVER_CLOSE_MS);
    expect(firstEnding(st, 3050, 200_000)?.fx).toEqual(closing);
  });

  it('different ticks never arm it (a desync the hash check answers), nor does one report with the other seat still here', () => {
    const differ = minted();
    seatMessage(differ, 0, { t: 'over', tick: 399 }, 1000, mint);
    seatMessage(differ, 1, { t: 'over', tick: 419 }, 1000, mint);
    expect(differ.closeAtMs).toBeNull();
    expect(firstEnding(differ, 1050, 1000 + 2 * OVER_CLOSE_MS)).toBeNull();
    const alone = minted();
    seatMessage(alone, 0, { t: 'over', tick: 399 }, 1000, mint);
    expect(firstEnding(alone, 1050, 1000 + 2 * OVER_CLOSE_MS)).toBeNull();
  });

  it('different ticks stay unarmed when a seat then goes (review fix): a lone-report rule must not rescue a disagreement', () => {
    for (const gone of [0, 1] as const) {
      const st = minted();
      seatMessage(st, 0, { t: 'over', tick: 399 }, 1000, mint);
      seatMessage(st, 1, { t: 'over', tick: 419 }, 1000, mint);
      seatGone(st, gone, 2000);
      expect(st.closeAtMs, `seat ${gone} gone`).toBeNull();
      expect(firstEnding(st, 2050, 2000 + 2 * OVER_CLOSE_MS), `seat ${gone} gone`).toBeNull();
    }
  });

  it('a report naming a tick the room has not minted is ignored (review fix)', () => {
    const st = minted(400);   // frames 0..399 sent
    seatGone(st, 1, 900);
    seatMessage(st, 0, { t: 'over', tick: 400 }, 1000, mint);
    seatMessage(st, 0, { t: 'over', tick: 5000 }, 1000, mint);
    expect(st.over).toEqual([-1, -1]);
    expect(st.closeAtMs).toBeNull();
    seatMessage(st, 0, { t: 'over', tick: 399 }, 1100, mint);   // the last minted tick is a real result
    expect(st.over).toEqual([399, -1]);
    expect(st.closeAtMs).toBe(1100 + OVER_CLOSE_MS);
  });

  it('only a seat\'s first report counts', () => {
    const st = minted();
    seatMessage(st, 0, { t: 'over', tick: 399 }, 1000, mint);
    seatMessage(st, 0, { t: 'over', tick: 419 }, 1100, mint);
    expect(st.over).toEqual([399, -1]);
    seatMessage(st, 1, { t: 'over', tick: 419 }, 1200, mint);
    expect(st.closeAtMs).toBeNull();
  });

  it('a lobby or an ended room takes no report', () => {
    const lobby = createRoom('ABCDEF', 'm1', 0);
    seatJoin(lobby, 0, 'p0', 'Host', 0);
    seatGone(lobby, 0, 10);
    seatJoin(lobby, 0, 'p0', 'Host', 20);
    seatMessage(lobby, 0, { t: 'over', tick: 0 }, 30, mint);
    expect(lobby.over).toEqual([-1, -1]);
    const ended = running();
    seatMessage(ended, 1, { t: 'surrender' }, 10, mint);
    seatGone(ended, 1, 20);
    seatMessage(ended, 0, { t: 'over', tick: 0 }, 30, mint);
    expect(ended.closeAtMs).toBeNull();
  });

  it('a close falls due through a pause in force, and closeIfDue is the clock\'s own rule', () => {
    const st = minted();
    seatMessage(st, 0, { t: 'over', tick: 399 }, 1000, mint);
    seatMessage(st, 1, { t: 'over', tick: 399 }, 1000, mint);
    seatMessage(st, 0, { t: 'pause' }, 100_000, mint);   // a pause runs past the deadline
    expect(closeIfDue(st, 1000 + OVER_CLOSE_MS - 1)).toEqual([]);
    expect(closeIfDue(st, 1000 + OVER_CLOSE_MS)).toEqual(closing);
    expect(st.status).toBe('ended');
    expect(closeIfDue(st, 1000 + OVER_CLOSE_MS + 50)).toEqual([]);
  });

  it('the reports and the arming are lifecycle: each moves the persist key once, the wait does not', () => {
    const st = minted();
    const k0 = persistKey(st);
    seatMessage(st, 0, { t: 'over', tick: 399 }, 1000, mint);
    const k1 = persistKey(st);
    expect(k1).not.toBe(k0);
    seatMessage(st, 1, { t: 'over', tick: 399 }, 1000, mint);
    const k2 = persistKey(st);
    expect(k2).not.toBe(k1);
    for (let t = 1050; t < 60_000; t += 50) clockTick(st, t);   // the wait, stalled behind
    expect(persistKey(st)).toBe(k2);
    // Each half on its own is lifecycle too.
    const armedOnly = running();
    const before = persistKey(armedOnly);
    armedOnly.closeAtMs = 5;
    expect(persistKey(armedOnly)).not.toBe(before);
  });

  it('the deadline survives storage and revive; a room persisted before L-1 revives with none', () => {
    const st = minted();
    seatMessage(st, 0, { t: 'over', tick: 399 }, 1000, mint);
    seatMessage(st, 1, { t: 'over', tick: 399 }, 1000, mint);
    const stored: RoomState = JSON.parse(JSON.stringify(st));
    revive(stored, 0, 50_000);
    expect(stored.over).toEqual([399, 399]);
    expect(stored.closeAtMs).toBe(1000 + OVER_CLOSE_MS);
    expect(firstEnding(stored, 50_050, 200_000)?.at).toBe(1000 + OVER_CLOSE_MS);
    const legacy: Record<string, unknown> = JSON.parse(JSON.stringify(running()));
    delete legacy.over;
    delete legacy.closeAtMs;
    const old = legacy as unknown as RoomState;
    revive(old, 0, 9000);
    expect(old.over).toEqual([-1, -1]);
    expect(old.closeAtMs).toBeNull();
    expect(frames(clockTick(old, 9050))).toHaveLength(1);
    seatMessage(old, 0, { t: 'over', tick: 0 }, 9100, mint);
    seatMessage(old, 1, { t: 'over', tick: 0 }, 9100, mint);
    expect(old.closeAtMs).toBe(9100 + OVER_CLOSE_MS);
  });
});

describe('#559 H-1: logParts', () => {
  const frame = (tick: number, n = 0) => ({ tick, cmds: Array.from({ length: n }, (_, i) => ({ seat: 0 as const, seq: i, cmd: { kind: 'halt' as const, ids: [i] } })) });
  it('splits a log into runs of at most maxChars that rejoin to the log, numbered 0..parts-1', () => {
    const frames = Array.from({ length: 500 }, (_, t) => frame(t, t % 7));
    const parts = logParts(CONFIG, frames, 2000);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.flatMap((p) => p.frames)).toEqual(frames);
    parts.forEach((p, i) => {
      expect([p.part, p.parts, p.config]).toEqual([i, parts.length, CONFIG]);
      expect(JSON.stringify(p.frames).length).toBeLessThanOrEqual(2000 + 1);
    });
  });
  it('a short log is one part, an empty one is one empty part, and a frame over the limit goes alone', () => {
    expect(logParts(CONFIG, [frame(0)]).map((p) => [p.part, p.parts])).toEqual([[0, 1]]);
    expect(logParts(CONFIG, [])).toEqual([{ t: 'log', config: CONFIG, frames: [], part: 0, parts: 1 }]);
    const big = frame(1, 50);
    expect(logParts(CONFIG, [frame(0), big, frame(2)], 100).map((p) => p.frames.map((f) => f.tick))).toEqual([[0], [1], [2]]);
  });
});
