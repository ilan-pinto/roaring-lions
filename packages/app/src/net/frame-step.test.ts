import { describe, it, expect } from 'vitest';
import { LocalTransport, matchDigest, type Frame, type MatchConfig, type MatchTransport, type TransportStatus } from '@lions/net';
import type { Command } from '@lions/sim';
import { runFrames, seatWorldFor } from './frame-step';

const config = (over: Partial<MatchConfig> = {}): MatchConfig => ({
  matchId: 'ABCDEF', code: 'ABCDEF', seed: 5, map: 'tel_marum', mode: 'sandbox',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'a', callsign: 'a', kind: 'human' },
    { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'b', callsign: 'b', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 77, ...over,
});

/** A sim stand-in: entities 0-3 on side 0, 4-5 on side 1; `hash()` moves with
 *  every tick so a digest taken on the wrong tick is visible. `tickCount`
 *  starts at 100 on purpose (R32): the frame's tick, not the sim's count, is
 *  what keys an ack and a hash. */
function fakeSim() {
  const side = new Uint8Array([0, 0, 0, 0, 1, 1]);
  const s = {
    tickCount: 100,
    queued: [] as Command[],
    ranWith: [] as Command[][],
    hashCalls: 0,
    entityCount: side.length,
    width: 48,
    height: 40,
    structureCount: 3,
    tunnelCount: 1,
    state: { side },
    queueCommand(cmd: Command) { s.queued.push(cmd); },
    hash() { s.hashCalls++; return 1000 + s.tickCount; },
    runTick() { s.ranWith.push(s.queued.splice(0)); s.tickCount++; },
  };
  return s;
}

/** A room stand-in: hands out the frames it is given and records every report. */
class ScriptedTransport implements MatchTransport {
  readonly local = false;
  reports: [number, number | null][] = [];
  private frames: Frame[];
  constructor(frames: Frame[]) { this.frames = [...frames]; }
  queueCommand(): void {}
  take(max: number): Frame[] { return this.frames.splice(0, max); }
  reportTick(tick: number, digest: number | null): void { this.reports.push([tick, digest]); }
  status(): TransportStatus { return { kind: 'live', behind: this.frames.length }; }
  close(): void {}
}

const move = (ids: number[]): Command => ({ kind: 'move', ids, x: 0, y: 0 });

describe('runFrames', () => {
  it('local: a dispatched command waits for the next frame and runs on it', () => {
    const sim = fakeSim();
    const transport = new LocalTransport();
    const step = { transport, sim, seatWorld: seatWorldFor(null, sim), runTick: sim.runTick, config: null };
    transport.queueCommand(move([1, 2]));
    expect(runFrames(step, 0)).toEqual({ ran: 0, dropped: 0 });
    expect(sim.queued).toEqual([]);
    expect(runFrames(step, 3)).toEqual({ ran: 3, dropped: 0 });
    expect(sim.ranWith).toEqual([[move([1, 2])], [], []]);
    expect(sim.hashCalls).toBe(0);
  });
  it('a command naming an entity of another side is dropped and counted, its frame-mates still run', () => {
    const sim = fakeSim();
    const transport = new ScriptedTransport([{ tick: 0, cmds: [
      { seat: 1, seq: 0, cmd: move([4]) },
      { seat: 0, seq: 0, cmd: move([0]) },
      { seat: 1, seq: 1, cmd: move([3, 5]) },
    ] }]);
    const step = { transport, sim, seatWorld: seatWorldFor(config(), sim), runTick: sim.runTick, config: config() };
    expect(runFrames(step, 4)).toEqual({ ran: 1, dropped: 2 });
    expect(sim.ranWith).toEqual([[move([0])]]);
  });
  it('local: single-player is seat 0 on side 0, so an order outside side 0 is dropped there too', () => {
    const sim = fakeSim();
    const transport = new LocalTransport();
    const step = { transport, sim, seatWorld: seatWorldFor(null, sim), runTick: sim.runTick, config: null };
    transport.queueCommand(move([5]));
    transport.queueCommand(move([0, 3]));
    expect(runFrames(step, 1)).toEqual({ ran: 1, dropped: 1 });
    expect(sim.ranWith).toEqual([[move([0, 3])]]);
  });
  it('reports every frame by the FRAME tick, with the match digest exactly on hash ticks', () => {
    const sim = fakeSim();
    const frames: Frame[] = Array.from({ length: 41 }, (_, tick) => ({ tick, cmds: [] }));
    const transport = new ScriptedTransport(frames);
    const cfg = config();
    const step = { transport, sim, seatWorld: seatWorldFor(cfg, sim), runTick: sim.runTick, config: cfg };
    let ran = 0;
    for (let i = 0; i < 20; i++) ran += runFrames(step, 4).ran;
    expect(ran).toBe(41);
    expect(transport.reports.map(([t]) => t)).toEqual(frames.map((_, i) => i));
    const hashed = transport.reports.filter(([, d]) => d !== null);
    // Ticks 19 and 39 are the ends of the first two 20-tick windows. The digest
    // is taken AFTER the frame's tick ran: the sim stood at 100 + tick + 1.
    expect(hashed).toEqual([
      [19, matchDigest(1000 + 100 + 20, 0, 77)],
      [39, matchDigest(1000 + 100 + 40, 0, 77)],
    ]);
    expect(sim.hashCalls).toBe(2);
  });
});

describe('seatWorldFor', () => {
  it('single-player: seat 0 is side 0; entities past the count do not exist', () => {
    const sim = fakeSim();
    const w = seatWorldFor(null, sim);
    expect(w.sideOfSeat(0)).toBe(0);
    expect(w.sideOfEntity(4)).toBe(1);
    expect(w.sideOfEntity(6)).toBeUndefined();
    expect(w.sideOfEntity(-1)).toBeUndefined();
  });
  it('knows the map size and which structures and tunnels exist', () => {
    const sim = fakeSim();
    const w = seatWorldFor(null, sim);
    expect([w.width, w.height]).toEqual([48, 40]);
    expect([0, 2, 3, -1].map((i) => w.structureExists(i))).toEqual([true, true, false, false]);
    expect([0, 1, -1].map((i) => w.tunnelExists(i))).toEqual([true, false, false]);
    expect(w.structureExists(1.5)).toBe(false);
    expect(w.tunnelExists(NaN)).toBe(false);
  });
  it('a room: each seat is the side its config names', () => {
    const sim = fakeSim();
    const cfg = config();
    cfg.seats[1] = { ...cfg.seats[1], side: 1 };
    const w = seatWorldFor(cfg, sim);
    expect(w.sideOfSeat(0)).toBe(0);
    expect(w.sideOfSeat(1)).toBe(1);
  });
});
