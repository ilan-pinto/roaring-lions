import { describe, it, expect } from 'vitest';
import { LocalTransport, matchDigest, validateCommand, type Frame, type MatchConfig, type MatchTransport, type TransportStatus } from '@lions/net';
import type { Command } from '@lions/sim';
import { runFrames, seatWorldFor } from './frame-step';
import { shippedContentDigest } from './content-digest';

/** The digest of THIS client's own content (L4), as a test hands it in. The
 *  config fixture's room-minted `dataDigest` is 77 on purpose: a value
 *  `runFrames` must ignore. */
const OWN = 55;

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
    tunnelOwner(r: number) { return r === 0 ? 1 : -1; },
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
    const step = { transport, sim, seatWorld: seatWorldFor(cfg, sim), runTick: sim.runTick, config: cfg, dataDigest: OWN };
    let ran = 0;
    for (let i = 0; i < 20; i++) ran += runFrames(step, 4).ran;
    expect(ran).toBe(41);
    expect(transport.reports.map(([t]) => t)).toEqual(frames.map((_, i) => i));
    const hashed = transport.reports.filter(([, d]) => d !== null);
    // Ticks 19 and 39 are the ends of the first two 20-tick windows. The digest
    // is taken AFTER the frame's tick ran: the sim stood at 100 + tick + 1.
    expect(hashed).toEqual([
      [19, matchDigest(1000 + 100 + 20, 0, OWN)],
      [39, matchDigest(1000 + 100 + 40, 0, OWN)],
    ]);
    expect(sim.hashCalls).toBe(2);
  });
  it('runtimeDigest (N2-P2): folded in place of 0, asked once per hash tick, after that tick ran', () => {
    const sim = fakeSim();
    const frames: Frame[] = Array.from({ length: 41 }, (_, tick) => ({ tick, cmds: [] }));
    const transport = new ScriptedTransport(frames);
    const cfg = config();
    const asked: number[] = [];
    // A digest that moves with the sim, so one read on the wrong tick shows.
    const runtimeDigest = (): number => { asked.push(sim.tickCount); return 5000 + sim.tickCount; };
    const step = { transport, sim, seatWorld: seatWorldFor(cfg, sim), runTick: sim.runTick, config: cfg, runtimeDigest, dataDigest: OWN };
    for (let i = 0; i < 20; i++) runFrames(step, 4);
    expect(transport.reports.filter(([, d]) => d !== null)).toEqual([
      [19, matchDigest(1000 + 100 + 20, 5000 + 100 + 20, OWN)],
      [39, matchDigest(1000 + 100 + 40, 5000 + 100 + 40, OWN)],
    ]);
    expect(asked).toEqual([120, 140]);
  });
  it('dataDigest (L4): absent, this client folds its OWN shipped content digest -- never the room-minted config.dataDigest', () => {
    const sim = fakeSim();
    const frames: Frame[] = Array.from({ length: 20 }, (_, tick) => ({ tick, cmds: [] }));
    const transport = new ScriptedTransport(frames);
    const cfg = config();
    const step = { transport, sim, seatWorld: seatWorldFor(cfg, sim), runTick: sim.runTick, config: cfg };
    runFrames(step, 20);
    expect(shippedContentDigest()).not.toBe(77);
    expect(transport.reports.at(-1)).toEqual([19, matchDigest(1000 + 100 + 20, 0, shippedContentDigest())]);
  });
  it('runtimeDigest: never asked in single-player, where nothing is hashed', () => {
    const sim = fakeSim();
    const transport = new LocalTransport();
    let asked = 0;
    const step = { transport, sim, seatWorld: seatWorldFor(null, sim), runTick: sim.runTick, config: null, runtimeDigest: () => ++asked };
    runFrames(step, 40);
    expect(asked).toBe(0);
  });
  it('stopAfter: no frame runs after the one it says stop on, and that one is still reported', () => {
    const sim = fakeSim();
    const frames: Frame[] = Array.from({ length: 30 }, (_, tick) => ({ tick, cmds: [] }));
    const transport = new ScriptedTransport(frames);
    const cfg = config();
    const asked: number[] = [];
    const step = {
      transport, sim, seatWorld: seatWorldFor(cfg, sim), runTick: sim.runTick, config: cfg, dataDigest: OWN,
      stopAfter: (tick: number) => { asked.push(tick); return tick === 19; },
    };
    // One batch holds all 30 frames: the stop lands mid-batch, and the 10
    // behind it are not run (the match is over; the caller steps no more).
    expect(runFrames(step, 30).ran).toBe(20);
    expect(asked).toEqual(Array.from({ length: 20 }, (_, t) => t));
    expect(sim.tickCount).toBe(100 + 20);
    expect(transport.reports.at(-1)).toEqual([19, matchDigest(1000 + 100 + 20, 0, OWN)]);
  });
  it('beforeFrame: once per frame, with the frame, before its commands are queued; never when no frame comes', () => {
    const sim = fakeSim();
    const frames: Frame[] = [
      { tick: 0, cmds: [{ seat: 0, seq: 0, cmd: move([0]) }] },
      { tick: 1, cmds: [] },
      { tick: 2, cmds: [{ seat: 1, seq: 0, cmd: move([4]) }, { seat: 0, seq: 1, cmd: move([1]) }] },
    ];
    const transport = new ScriptedTransport(frames);
    const cfg = config();
    const seen: { tick: number; queuedBefore: number; ranBefore: number }[] = [];
    const step = {
      transport, sim, seatWorld: seatWorldFor(cfg, sim), runTick: sim.runTick, config: cfg,
      beforeFrame: (f: Frame) => { seen.push({ tick: f.tick, queuedBefore: sim.queued.length, ranBefore: sim.ranWith.length }); },
    };
    expect(runFrames(step, 2).ran).toBe(2);
    expect(runFrames(step, 5).ran).toBe(1);
    expect(runFrames(step, 5).ran).toBe(0);   // the transport yields nothing: no call
    // Each call came before that frame's commands reached the sim, and after the previous frame's tick ran.
    expect(seen).toEqual([
      { tick: 0, queuedBefore: 0, ranBefore: 0 },
      { tick: 1, queuedBefore: 0, ranBefore: 1 },
      { tick: 2, queuedBefore: 0, ranBefore: 2 },
    ]);
  });
  it('afterFrame (snapshot S4 T4): once per frame, at the frame boundary, with the digest just reported, before stopAfter', () => {
    const sim = fakeSim();
    // Frames 18, 19, 20: 19 is the first hash tick of a 20-tick window. The fake sim's tickCount starts at 100.
    const transport = new ScriptedTransport([{ tick: 18, cmds: [] }, { tick: 19, cmds: [] }, { tick: 20, cmds: [] }]);
    const cfg = config();
    const order: string[] = [];
    const seen: { tick: number; digest: number | null; simTick: number; reported: number }[] = [];
    const step = {
      transport, sim, seatWorld: seatWorldFor(cfg, sim), runTick: sim.runTick, config: cfg, dataDigest: OWN,
      afterFrame: (tick: number, digest: number | null) => {
        order.push(`after${tick}`);
        seen.push({ tick, digest, simTick: sim.tickCount, reported: transport.reports.length });
      },
      stopAfter: (tick: number) => { order.push(`stop${tick}`); return false; },
    };
    expect(runFrames(step, 3).ran).toBe(3);
    // Literals: the sim stood at 100 + (frames run so far) when each callback ran -- the boundary, not the batch's end (123).
    expect(seen).toEqual([
      { tick: 18, digest: null, simTick: 101, reported: 1 },
      { tick: 19, digest: matchDigest(1000 + 102, 0, OWN), simTick: 102, reported: 2 },
      { tick: 20, digest: null, simTick: 103, reported: 3 },
    ]);
    expect(order).toEqual(['after18', 'stop18', 'after19', 'stop19', 'after20', 'stop20']);
    expect(transport.reports[1]).toEqual([19, matchDigest(1000 + 102, 0, OWN)]);
  });
  it('afterFrame: the last frame before a stop is still called; a frame after the stop is not run and not called', () => {
    const sim = fakeSim();
    const transport = new ScriptedTransport([{ tick: 0, cmds: [] }, { tick: 1, cmds: [] }, { tick: 2, cmds: [] }]);
    const called: number[] = [];
    const step = {
      transport, sim, seatWorld: seatWorldFor(null, sim), runTick: sim.runTick, config: null,
      afterFrame: (tick: number) => { called.push(tick); },
      stopAfter: (tick: number) => tick === 1,
    };
    expect(runFrames(step, 3).ran).toBe(2);
    expect(called).toEqual([0, 1]);
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
  it('reads the structure and tunnel counts live: the world is built before they are added', () => {
    const sim = fakeSim();
    const w = seatWorldFor(null, sim);
    expect([w.structureExists(3), w.tunnelExists(1)]).toEqual([false, false]);
    sim.structureCount = 4;
    sim.tunnelCount = 2;
    expect([w.structureExists(3), w.tunnelExists(1)]).toEqual([true, true]);
  });
  it('a room: each seat is the side its config names', () => {
    const sim = fakeSim();
    const cfg = config();
    cfg.seats[1] = { ...cfg.seats[1], side: 1 };
    const w = seatWorldFor(cfg, sim);
    expect(w.sideOfSeat(0)).toBe(0);
    expect(w.sideOfSeat(1)).toBe(1);
  });
  it('GH-681: each seat\'s faction from its config (single-player is KDF), and the route owner from the sim', () => {
    const sim = fakeSim();
    expect(seatWorldFor(null, sim).factionOfSeat(0)).toBe('kdf');
    const cfg = config();
    cfg.seats[1] = { ...cfg.seats[1], faction: 'sarim' };
    const w = seatWorldFor(cfg, sim);
    expect([w.factionOfSeat(0), w.factionOfSeat(1)]).toEqual(['kdf', 'sarim']);
    expect([w.tunnelOwner(0), w.tunnelOwner(1), w.tunnelOwner(NaN)]).toEqual([1, -1, -1]);
  });
  it('N3 Task 4: economy is economyRoom(config) -- off in single-player, a co-op room and a mirror; on KDF v Sarim', () => {
    const sim = fakeSim();
    expect(seatWorldFor(null, sim).economy).toBe(false);
    expect(seatWorldFor(config(), sim).economy).toBe(false);
    const mirror = config({ mode: 'versus' });
    expect(seatWorldFor(mirror, sim).economy).toBe(false);
    const matchup = config({ mode: 'versus' });
    matchup.seats[1] = { ...matchup.seats[1], side: 1, faction: 'sarim' };
    const w = seatWorldFor(matchup, sim);
    expect([w.versus, w.economy]).toEqual([true, true]);
    // ... so the Sarim guest's build for its own side passes, and the host's forged one drops.
    expect(validateCommand({ kind: 'build', side: 1, unit: 'sarim_rifles' }, 1, w)).toBe(true);
    expect(validateCommand({ kind: 'build', side: 1, unit: 'sarim_rifles' }, 0, w)).toBe(false);
  });
  it('LD1 (N3): a Sarim HOST is seat 0 on side 1, and it alone may take its side-1 units into its side-1 route', () => {
    // The room's LD1 config: seat 0 Sarim on side 1, seat 1 KDF on side 0. Route 0 is side 1's (fakeSim).
    const sim = fakeSim();
    const cfg = config({ mode: 'versus' });
    cfg.seats[0] = { ...cfg.seats[0], side: 1, faction: 'sarim' };
    cfg.seats[1] = { ...cfg.seats[1], side: 0, faction: 'kdf' };
    const w = seatWorldFor(cfg, sim);
    expect([w.sideOfSeat(0), w.sideOfSeat(1)]).toEqual([1, 0]);
    expect([w.factionOfSeat(0), w.factionOfSeat(1)]).toEqual(['sarim', 'kdf']);
    // Entities 4-5 are side 1: the Sarim host's own.
    expect(validateCommand({ kind: 'enterTunnel', ids: [4], tunnel: 0 }, 0, w)).toBe(true);
    expect(validateCommand({ kind: 'vent', ids: [5], mode: 'raid' }, 0, w)).toBe(true);
    // The KDF guest (side 0) can neither send its own units down nor touch the host's.
    expect(validateCommand({ kind: 'enterTunnel', ids: [0], tunnel: 0 }, 1, w)).toBe(false);
    expect(validateCommand({ kind: 'enterTunnel', ids: [4], tunnel: 0 }, 1, w)).toBe(false);
    expect(validateCommand({ kind: 'vent', ids: [0], mode: 'raid' }, 1, w)).toBe(false);
    // And the host cannot name the guest's side-0 units.
    expect(validateCommand({ kind: 'enterTunnel', ids: [0], tunnel: 0 }, 0, w)).toBe(false);
  });
});
