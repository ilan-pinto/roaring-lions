// The match recorder (GH-1398, slice 1), against the existing two-client harness: a recorded economy room (`economy-stream.test-helper`:
// both seats producing, tunnel orders, one forged build the ownership check drops) must re-sim to the same tick and hash, and a tampered
// recording must not. Every check was seen red under the one-line mutations listed in the commit that landed it.
import { describe, expect, it } from 'vitest';
import { fx } from '@lions/sim';
import { canonicalOrder, matchCapTicksOf, type Frame, type MatchTransport, type Stamped, type TransportStatus } from '@lions/net';
import { economyStreamConfig, economyStreamFrames, runEconomyClient, ECONOMY_STREAM_TICKS } from '../../../packages/app/src/net/economy-stream.test-helper';
import { MatchRecorder, RecorderError, scrubbedConfig } from '../../../packages/app/src/net/match-recorder';
import { parseReplay, ReplayRefused, serializeReplay, type ReplayFile } from '../../../packages/app/src/net/replay-file';
import { buildMatchWorld, matchTick } from '../../../packages/app/src/net/match-world';
import { runFrames, seatWorldFor } from '../../../packages/app/src/net/frame-step';
import { replayToEnd } from './arena-replay';
import { versusConfig } from './test-config';
import { verifyFile, verifyRecording } from './replay-verify';

const BUILD = '0.133.10+0123456789abcdef';

/** One client plays the stream with a recorder on its `beforeFrame`; the recording closes on that client's own sim. */
function recordStream(config = economyStreamConfig()): { text: string; file: ReplayFile; simHash: number; ticks: number } {
  let world: { sim: { hash(): number } } | null = null;
  const rec = new MatchRecorder({ build: BUILD, config, sim: { hash: () => { if (world === null) throw new Error('no world yet'); return world.sim.hash(); } } });
  const r = runEconomyClient(economyStreamFrames(), { onFrame: rec.record, afterFrame: rec.afterFrame, onWorld: (w) => { world = w; } });
  const file = rec.finish({ digest: { tick: r.ticks, hash: r.simHash }, outcome: 'unfinished', by: 'cap' });
  return { text: serializeReplay(file), file, simHash: r.simHash, ticks: r.ticks };
}

/** A frame stream handed out from a list, as `two-client.test.ts`'s `Feed` does (no hashing: a recording wants only the frames). */
class Feed implements MatchTransport {
  readonly local = false;
  private frames: Frame[];
  constructor(frames: readonly Frame[]) { this.frames = [...frames]; }
  queueCommand(): void {}
  take(max: number): Frame[] { return this.frames.splice(0, max); }
  reportTick(): void {}
  status(): TransportStatus { return { kind: 'live', behind: this.frames.length }; }
  close(): void {}
}

const SKIRMISH_TICKS = 300;

/** A mirror-room skirmish with MOVEMENT (the economy stream has none): both sides attack-move at the other's end, the second
 *  seat re-routes at tick 120. Every order goes through a frame; a direct runtime call would not be in the log. */
function recordSkirmish(): { text: string; file: ReplayFile; simHash: number } {
  const config = versusConfig('beit_sahwan_outskirts', { seed: 77 });
  const w = buildMatchWorld(config);
  const [hx, hy] = w.anchors.hostile;
  const [fx0, fy0] = w.anchors.friendly;
  const byTick = new Map<number, Stamped[]>([
    [5, [
      { seat: 0, seq: 0, cmd: { kind: 'attackMove', ids: w.bySide[0], x: fx.from(hx + 0.5), y: fx.from(hy + 0.5) } },
      { seat: 1, seq: 0, cmd: { kind: 'attackMove', ids: w.bySide[1], x: fx.from(fx0 + 0.5), y: fx.from(fy0 + 0.5) } },
    ]],
    [120, [{ seat: 1, seq: 1, cmd: { kind: 'move', ids: w.bySide[1], x: fx.from(fx0 + 4.5), y: fx.from(fy0 + 2.5) } }]],
  ]);
  const frames: Frame[] = [];
  for (let t = 0; t < SKIRMISH_TICKS; t++) frames.push({ tick: t, cmds: canonicalOrder(byTick.get(t) ?? []) });
  const rec = new MatchRecorder({ build: BUILD, config, sim: w.sim });
  const step = { transport: new Feed(frames), sim: w.sim, seatWorld: seatWorldFor(config, w.sim), config: null, runTick: () => { matchTick(w); }, beforeFrame: rec.record, afterFrame: rec.afterFrame };
  expect(runFrames(step, SKIRMISH_TICKS).ran).toBe(SKIRMISH_TICKS);
  const file = rec.finish({ digest: { tick: w.sim.tickCount, hash: w.sim.hash() }, outcome: 'unfinished', by: 'cap' });
  return { text: serializeReplay(file), file, simHash: w.sim.hash() };
}

describe('a recorded economy room re-sims to the same tick and hash', () => {
  const rec = recordStream();

  it('the recording holds the frames the client ran, and the sim ended where the recording says', () => {
    expect(rec.ticks).toBe(ECONOMY_STREAM_TICKS);
    expect(rec.file.end.ticks).toBe(ECONOMY_STREAM_TICKS);
    expect(rec.file.end.referee).toEqual({ tick: ECONOMY_STREAM_TICKS, hash: rec.simHash });
    // The log is sparse: only ticks that carried a command, and the stream has orders on both seats.
    expect(rec.file.frames.length).toBeGreaterThan(5);
    expect(rec.file.frames.length).toBeLessThan(ECONOMY_STREAM_TICKS / 4);
    expect(new Set(rec.file.frames.flatMap((f) => f.c.map((s) => s.seat)))).toEqual(new Set([0, 1]));
  });

  it('the header says what was played: build, seed, map, sides, cap and the one-game series', () => {
    const h = rec.file.header;
    expect(h.v).toBe(2);
    expect(h.build).toBe(BUILD);
    expect(h.game).toEqual({ n: 1, of: 1, seed: 1234, map: 'wadi_tarfan', matchup: 'sarim v kdf', capTicks: matchCapTicksOf(economyStreamConfig()), pace: 1, roundWallMs: 0 });
    expect(h.config.seats.map((s) => [s.side, s.faction])).toEqual([[1, 'sarim'], [0, 'kdf']]);
    expect(h.config.mode).toBe('versus');
  });

  it('is small: a 1,200-tick two-seat economy match is under 5 KB of text (2,652 bytes, 13 ticks with orders)', () => {
    expect(rec.text.length).toBeLessThan(5_000);
  });

  it('a fresh sim fed the recorded text ends at the identical tick and hash', () => {
    const v = verifyRecording(rec.text, { build: BUILD });
    expect(v.kind).toBe('ok');
    if (v.kind === 'ok') expect(v.digest).toEqual({ tick: ECONOMY_STREAM_TICKS, hash: rec.simHash });
    // ...and the hash is a state, not a constant: the empty stream ends elsewhere.
    expect(replayToEnd({ ...rec.file, frames: [] }).hash).not.toBe(rec.simHash);
  }, 60_000);

  it('the replay speed changes nothing (the arena\'s own property, held for a recording)', () => {
    expect(replayToEnd(parseReplay(rec.text, { build: BUILD }), { perFrame: 1 })).toEqual(replayToEnd(parseReplay(rec.text, { build: BUILD }), { perFrame: 16 }));
  }, 60_000);

  it('the config in the file names no person and no room, and the scrub does not move the hash', () => {
    const c = rec.file.header.config;
    expect([c.matchId, c.code, c.seats[0].player, c.seats[1].player, c.seats[0].callsign, c.seats[1].callsign]).toEqual(['replay', 'REPLAY', 'seat-0', 'seat-1', 'Seat 0', 'Seat 1']);
    expect(rec.file.header.labels).toEqual(['sarim', 'kdf']);
    expect(rec.text).not.toMatch(/ABCDEF|"p0"|"c1"/);
    // The unscrubbed room ran the same match to the same hash.
    expect(economyStreamConfig().seats[0].player).toBe('p0');
    expect(scrubbedConfig(economyStreamConfig()).seats[0].player).toBe('seat-0');
    expect(rec.simHash).toBe(runEconomyClient(economyStreamFrames()).simHash);
  }, 60_000);
});

describe('a tampered recording does not reach the recorded hash (falsification)', () => {
  const rec = recordStream();
  const clone = (): ReplayFile => parseReplay(rec.text, { build: BUILD });
  const desyncs = (file: ReplayFile): boolean => verifyFile(file).kind === 'desync';

  it('control: the untouched file verifies', () => expect(verifyFile(clone()).kind).toBe('ok'));

  it('one rally point moved by a tile (the economy room)', () => {
    const f = clone();
    const cmd = f.frames.flatMap((fr) => fr.c).find((s) => s.cmd.kind === 'setRally');
    if (cmd === undefined || cmd.cmd.kind !== 'setRally') throw new Error('the stream has no setRally');
    cmd.cmd.x += 65536;
    expect(desyncs(f)).toBe(true);
  }, 60_000);

  it('one command dropped from the log', () => {
    const f = clone();
    const first = f.frames.find((fr) => fr.c.some((s) => s.cmd.kind === 'build'));
    if (first === undefined) throw new Error('the stream has no build');
    const at = first.c.findIndex((s) => s.cmd.kind === 'build');
    first.c.splice(at, 1);
    if (first.c.length === 0) f.frames.splice(f.frames.indexOf(first), 1);
    expect(desyncs(f)).toBe(true);
  }, 60_000);

  it('one command moved to the next tick', () => {
    const f = clone();
    const fr = f.frames.find((x) => x.c.some((s) => s.cmd.kind === 'build'));
    if (fr === undefined) throw new Error('the stream has no build');
    const at = fr.c.findIndex((s) => s.cmd.kind === 'build');
    const [moved] = fr.c.splice(at, 1);
    if (fr.c.length === 0) f.frames.splice(f.frames.indexOf(fr), 1);
    const target = f.frames.find((x) => x.t === fr.t + 1);
    if (target) target.c.push(moved);
    else f.frames.push({ t: fr.t + 1, c: [moved] });
    f.frames.sort((p, q) => p.t - q.t);
    expect(desyncs(f)).toBe(true);
  }, 60_000);

  it('the seed changed', () => {
    const f = clone();
    f.header.config.seed += 1;
    expect(desyncs(f)).toBe(true);
  }, 60_000);

  it('a recorded tick that is not where the sim stopped is a desync even when the hash is the same', () => {
    const f = clone();
    f.end.referee = { tick: f.end.referee.tick + 1, hash: f.end.referee.hash };
    expect(desyncs(f)).toBe(true);
  }, 60_000);

  it('a recorded hash that is not the sim\'s (a doctored end line) is a desync with both numbers', () => {
    const f = clone();
    f.end.referee = { tick: f.end.referee.tick, hash: f.end.referee.hash ^ 1 };
    const v = verifyFile(f);
    expect(v.kind).toBe('desync');
    if (v.kind === 'desync') {
      expect(v.replayed.hash).toBe(rec.simHash);
      expect(v.recorded.hash).toBe(rec.simHash ^ 1);
    }
  }, 60_000);
});

describe('a recorded skirmish with movement re-sims to the same hash, and a moved target does not', () => {
  const sk = recordSkirmish();
  it('the recording is a movement match: only the orders are logged, and a fresh sim ends at the recorded tick and hash', () => {
    expect(sk.file.frames.map((f) => f.t)).toEqual([5, 120]);
    expect(sk.file.header.config.mode).toBe('versus');
    const v = verifyRecording(sk.text, { build: BUILD });
    expect(v.kind).toBe('ok');
    if (v.kind === 'ok') expect(v.digest).toEqual({ tick: SKIRMISH_TICKS, hash: sk.simHash });
    // The orders moved things: the same match with no orders ends elsewhere.
    expect(replayToEnd({ ...sk.file, frames: [] }).hash).not.toBe(sk.simHash);
  }, 60_000);
  it('one attackMove target moved by a tile is a desync', () => {
    const f = parseReplay(sk.text, { build: BUILD });
    const cmd = f.frames[0].c[0].cmd;
    if (cmd.kind !== 'attackMove') throw new Error('first order is not an attackMove');
    cmd.x += 65536;
    expect(verifyFile(f).kind).toBe('desync');
  }, 60_000);
  it('the re-route dropped is a desync', () => {
    const f = parseReplay(sk.text, { build: BUILD });
    f.frames.pop();
    expect(verifyFile(f).kind).toBe('desync');
  }, 60_000);
  it('an order from the wrong seat is dropped by the replay exactly as it was by the match: the hash is the same', () => {
    // Seat 0 forged an order naming seat 1's units: the ownership check drops it in the match and in the replay.
    const config = versusConfig('beit_sahwan_outskirts', { seed: 77 });
    const w = buildMatchWorld(config);
    const forged: Stamped = { seat: 0, seq: 9, cmd: { kind: 'move', ids: w.bySide[1], x: fx.from(2.5), y: fx.from(2.5) } };
    const run = (extra: Stamped[]): number => {
      const world = buildMatchWorld(config);
      const rec = new MatchRecorder({ build: BUILD, config });
      const frames: Frame[] = Array.from({ length: 60 }, (_, t) => ({ tick: t, cmds: t === 10 ? canonicalOrder(extra) : [] }));
      const step = { transport: new Feed(frames), sim: world.sim, seatWorld: seatWorldFor(config, world.sim), config: null, runTick: () => { matchTick(world); }, beforeFrame: rec.record };
      runFrames(step, 60);
      const file = rec.finish({ digest: { tick: world.sim.tickCount, hash: world.sim.hash() }, outcome: 'unfinished', by: 'cap' });
      const v = verifyFile(file);
      expect(v.kind).toBe('ok');
      return world.sim.hash();
    };
    expect(run([forged])).toBe(run([]));
  }, 60_000);
});

describe('a recording from another build or version is refused, never replayed', () => {
  const rec = recordStream();
  it('another build is refused before a frame is read', () => {
    const v = verifyRecording(rec.text, { build: '0.134.0+fedcba9876543210' });
    expect(v.kind).toBe('refused');
    if (v.kind === 'refused') expect(v.code).toBe('build_mismatch');
    expect(() => parseReplay(rec.text, { build: '0.134.0+fedcba9876543210' })).toThrow(ReplayRefused);
  });
  it('another format version is refused as a bad file, naming the versions this build reads', () => {
    const v = verifyRecording(rec.text.replace('"v":2', '"v":3'), { build: BUILD });
    expect(v.kind).toBe('refused');
    if (v.kind === 'refused') {
      expect(v.code).toBe('bad_file');
      expect(v.why).toMatch(/format version 3, this build reads 1 to 2/);
    }
  });
  it('a recording cut off before its end line is refused as incomplete', () => {
    const lines = rec.text.trimEnd().split('\n');
    const v = verifyRecording(lines.slice(0, -1).join('\n') + '\n', { build: BUILD });
    expect(v.kind).toBe('refused');
    if (v.kind === 'refused') expect(v.code).toBe('incomplete');
  });
});

describe('MatchRecorder guards', () => {
  const frame = (tick: number): Frame => ({ tick, cmds: [] });
  const make = () => new MatchRecorder({ build: BUILD, config: economyStreamConfig() });
  it('refuses a frame out of order, a repeat and a gap', () => {
    const r = make();
    r.record(frame(0));
    expect(() => r.record(frame(0))).toThrow(RecorderError);
    expect(() => r.record(frame(2))).toThrow(RecorderError);
    r.record(frame(1));
    expect(r.ticks).toBe(2);
  });
  it('refuses to close on a sim that ran a different number of ticks than were recorded', () => {
    const r = make();
    r.record(frame(0));
    expect(() => r.finish({ digest: { tick: 2, hash: 1 }, outcome: 'x', by: 'y' })).toThrow(RecorderError);
  });
  it('closes once, and takes no frame after', () => {
    const r = make();
    r.record(frame(0));
    r.finish({ digest: { tick: 1, hash: 1 }, outcome: 'x', by: 'y' });
    expect(() => r.finish({ digest: { tick: 1, hash: 1 }, outcome: 'x', by: 'y' })).toThrow(RecorderError);
    expect(() => r.record(frame(1))).toThrow(RecorderError);
  });
  it('copies what it records: a transport that reuses its frame objects cannot change the log', () => {
    const r = make();
    const f: Frame = { tick: 0, cmds: [{ seat: 0, seq: 0, cmd: { kind: 'halt', ids: [1] } }] };
    r.record(f);
    f.cmds[0] = { seat: 1, seq: 9, cmd: { kind: 'halt', ids: [2] } };
    const file = r.finish({ digest: { tick: 1, hash: 1 }, outcome: 'x', by: 'y' });
    expect(file.frames).toEqual([{ t: 0, c: [{ seat: 0, seq: 0, cmd: { kind: 'halt', ids: [1] } }] }]);
  });
});
