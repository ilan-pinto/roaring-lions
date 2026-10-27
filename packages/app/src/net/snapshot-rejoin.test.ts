import { beforeAll, describe, expect, it, vi } from 'vitest';
import { canonicalOrder, matchDigest, sidesOfFactions, validateConfig, type Frame, type MatchConfig, type MatchTransport, type Stamped, type TransportStatus } from '@lions/net';
import { encodeSim, fx, restoreSim, type Command } from '@lions/sim';
import { economyStreamConfig, economyStreamFrames } from './economy-stream.test-helper';
import { runFrames, seatWorldFor } from './frame-step';
import { buildMatchWorld, matchTick, type MatchWorld } from './match-world';
import { shippedContentDigest } from './content-digest';
import type { Prepared, Verified } from './snapshot-link';
import { restoreForRejoin, settleRejoin, type RestoreDeps } from './snapshot-rejoin';

/** The room code, which the real room also mints as the matchId. */
const CODE = 'ABCDEF';
const EVERY = 1200;

/** A KDF v KDF (mirror) room on tel_marum: no mission runtime. */
function mirrorConfig(): MatchConfig {
  const factions = ['kdf', 'kdf'] as const;
  const sides = sidesOfFactions([...factions]);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({
    matchId: CODE, code: CODE, seed: 7, map: 'tel_marum', mode: 'versus', seats: [seat(0), seat(1)],
    pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b-1', dataDigest: 0, snapshotEveryTicks: EVERY,
  });
  if (c === null) throw new Error('bad fixture');
  return c;
}

/** A KDF v Sarim economy room (wadi_tarfan): a mission runtime with camps, purses and queues. */
function economyConfig(): MatchConfig {
  return { ...economyStreamConfig(), matchId: CODE, snapshotEveryTicks: EVERY };
}

/** Orders for a mirror room, so the 1,200 ticks move units and fire: each seat attack-moves six of its own units to mid-map. */
function mirrorFrames(config: MatchConfig, w: MatchWorld): Frame[] {
  const entries: Stamped[] = [];
  for (const s of [0, 1] as const) {
    const cmd: Command = { kind: 'attackMove', ids: w.bySide[config.seats[s].side as 0 | 1].slice(0, 6), x: fx.from(24), y: fx.from(24) };
    entries.push({ seat: s, seq: 0, cmd });
  }
  const frames: Frame[] = [];
  for (let t = 0; t < EVERY; t++) frames.push({ tick: t, cmds: t === 10 ? canonicalOrder(entries) : [] });
  return frames;
}

const emptyFrames = (from: number, to: number): Frame[] => Array.from({ length: to - from }, (_, i) => ({ tick: from + i, cmds: [] }));

/** A room stand-in: hands out a fixed stream and records each reported digest by tick. */
class Feed implements MatchTransport {
  readonly local = false;
  readonly digests = new Map<number, number>();
  private frames: Frame[];
  constructor(frames: readonly Frame[]) { this.frames = [...frames]; }
  queueCommand(): void {}
  take(max: number): Frame[] { return this.frames.splice(0, max); }
  reportTick(tick: number, digest: number | null): void { if (digest !== null) this.digests.set(tick, digest); }
  status(): TransportStatus { return { kind: 'live', behind: this.frames.length }; }
  close(): void {}
}

/** The browser's own per-frame body over `w`, fed `frames`; returns the digests it reported. */
function play(config: MatchConfig, w: MatchWorld, frames: readonly Frame[]): Map<number, number> {
  const feed = new Feed(frames);
  const rt = w.runtime;
  runFrames({
    transport: feed, sim: w.sim, seatWorld: seatWorldFor(config, w.sim), config,
    runTick: () => { matchTick(w); },
    ...(rt === null ? {} : { runtimeDigest: () => rt.digest() }),
  }, frames.length);
  return feed.digests;
}

const digestOf = (w: MatchWorld): number => matchDigest(w.sim.hash(), w.runtime?.digest() ?? 0, shippedContentDigest());

/** The meta the producer writes at frame `tick`. */
const metaAt = (config: MatchConfig, tick: number, digest: number) => ({
  build: config.build, contentDigest: shippedContentDigest() >>> 0, matchId: config.matchId, frameTick: tick, matchDigest: digest >>> 0,
});

interface Played {
  name: string;
  config: MatchConfig;
  /** The source world at 1,199, then 1,399 (it ran 200 more). */
  source: MatchWorld;
  /** The snapshot of the source at 1,199, and what a rejoiner is handed. */
  raw: Uint8Array;
  verified: Verified;
  /** The signed digest at 1,199 (what the room's hash report carries). */
  digest: number;
}

/** Plays a room 1,200 ticks (0..1,199) and encodes at 1,199 with real meta. */
function playRoom(name: string, config: MatchConfig, framesOf: (w: MatchWorld) => Frame[]): Played {
  const source = buildMatchWorld(config);
  const frames = framesOf(source);
  expect(frames).toHaveLength(EVERY);
  play(config, source, frames);
  const digest = digestOf(source);
  const raw = encodeSim(source.sim, metaAt(config, EVERY - 1, digest), source.runtime ?? undefined);
  return { name, config, source, raw, verified: { raw, frameTick: EVERY - 1, matchDigest: digest >>> 0 }, digest };
}

let rooms: Played[] = [];
beforeAll(() => {
  const mirror = mirrorConfig();
  const economy = economyConfig();
  rooms = [
    playRoom('mirror', mirror, (w) => mirrorFrames(mirror, w)),
    playRoom('economy', economy, () => economyStreamFrames()),
  ];
}, 120_000);

const room = (name: 'mirror' | 'economy'): Played => {
  const r = rooms.find((x) => x.name === name);
  if (r === undefined) throw new Error('fixture missing');
  return r;
};

/** A copy of `r`'s snapshot re-encoded from a restored scratch world (so `r.source` is never touched). */
function reencoded(r: Played, change: (w: MatchWorld) => void, meta: { frameTick?: number; matchDigest?: number } = {}): Uint8Array {
  const scratch = buildMatchWorld(r.config);
  restoreSim(scratch.sim, r.raw, scratch.runtime ?? undefined);
  change(scratch);
  return encodeSim(scratch.sim, { ...metaAt(r.config, EVERY - 1, r.digest), ...meta }, scratch.runtime ?? undefined);
}

describe('restoreForRejoin: success, both rooms', () => {
  it('the premise: at least one of the two rooms has a NEGATIVE signed digest at 1,199 (the `>>> 0` case), and the header holds it unsigned', () => {
    const negatives = rooms.filter((r) => r.digest < 0).map((r) => r.name);
    expect(negatives.length).toBeGreaterThan(0);
    for (const r of rooms) expect(r.verified.matchDigest).toBe(r.digest >>> 0);
  });
  for (const name of ['mirror', 'economy'] as const) {
    it(`${name}: restores onto a fresh world with the source's digest, then 200 empty frames keep every hash-tick digest and the 1,399 bytes equal`, () => {
      const r = room(name);
      const got = restoreForRejoin(r.config, r.verified);
      expect(got.ok).toBe(true);
      if (!got.ok) return;
      expect(got.restoreMs).toBeGreaterThanOrEqual(0);
      expect(got.world).not.toBe(r.source);
      // Not a fresh world: the restore wrote something.
      expect(got.world.sim.hash()).not.toBe(buildMatchWorld(r.config).sim.hash());
      expect(digestOf(got.world) >>> 0).toBe(r.verified.matchDigest);
      expect(got.world.sim.tickCount).toBe(1200);
      expect(r.source.sim.tickCount).toBe(1200);
      // 200 more frames on each, through the same body.
      const more = emptyFrames(EVERY, EVERY + 200);
      const a = play(r.config, r.source, more);
      const b = play(r.config, got.world, more);
      expect(a.size).toBe(10);
      expect([...b]).toEqual([...a]);
      const at = EVERY + 199;
      const ea = encodeSim(r.source.sim, metaAt(r.config, at, a.get(at) ?? 0), r.source.runtime ?? undefined);
      const eb = encodeSim(got.world.sim, metaAt(r.config, at, b.get(at) ?? 0), got.world.runtime ?? undefined);
      expect(Buffer.from(eb).equals(Buffer.from(ea))).toBe(true);
    }, 60_000);
  }
  it('the economy room carries a runtime, the mirror does not (the two cases cover both restore shapes)', () => {
    expect(room('economy').source.runtime).not.toBeNull();
    expect(room('mirror').source.runtime).toBeNull();
  });
});

describe('restoreForRejoin: one case per post reason', () => {
  const r = (): Played => room('mirror');

  it('not_versus: a sandbox config', () => {
    const p = r();
    expect(restoreForRejoin({ ...p.config, mode: 'sandbox' }, p.verified)).toEqual({ ok: false, reason: 'not_versus' });
  });
  it('cadence_off: snapshotEveryTicks 0', () => {
    const p = r();
    expect(restoreForRejoin({ ...p.config, snapshotEveryTicks: 0 }, p.verified)).toEqual({ ok: false, reason: 'cadence_off' });
  });
  it('not_snapshot_tick: the snapshot is of frame 1,198', () => {
    const p = r();
    const raw = reencoded(p, () => undefined, { frameTick: 1198 });
    expect(restoreForRejoin(p.config, { raw, frameTick: 1198, matchDigest: p.verified.matchDigest })).toEqual({ ok: false, reason: 'not_snapshot_tick' });
  });
  it('config_match_mismatch: the room config names another matchId', () => {
    const p = r();
    expect(restoreForRejoin({ ...p.config, matchId: 'ZZZZZZ' }, p.verified)).toEqual({ ok: false, reason: 'config_match_mismatch' });
  });
  it('build_failed: buildMatchWorld throws', () => {
    const p = r();
    const build = vi.fn((): MatchWorld => { throw new Error('map is not shipped'); });
    expect(restoreForRejoin(p.config, p.verified, { build })).toEqual({ ok: false, reason: 'build_failed' });
    expect(build).toHaveBeenCalledTimes(1);
  });
  it('refused: the verified bytes cut short by 16 bytes (restoreForRejoin does not re-hash)', () => {
    const p = r();
    const cut = p.raw.slice(0, p.raw.length - 16);
    expect(restoreForRejoin(p.config, { ...p.verified, raw: cut })).toEqual({ ok: false, reason: 'refused' });
  });
  it('digest_after_restore: a world with one living entity killed, under the untouched world\'s header digest', () => {
    const p = r();
    const raw = reencoded(p, (w) => {
      const before = w.sim.hash();
      const id = w.bySide[0].find((e) => w.sim.state.alive[e] === 1);
      if (id === undefined) throw new Error('no living entity to kill');
      w.sim.debugKill(id);
      expect(w.sim.hash()).not.toBe(before);
    });
    // The header still says the untouched digest; the restored state hashes to something else.
    expect(readDigest(raw)).toBe(p.verified.matchDigest);
    expect(restoreForRejoin(p.config, { ...p.verified, raw })).toEqual({ ok: false, reason: 'digest_after_restore' });
  });
  it('restore_threw: a restore that throws a plain Error', () => {
    const p = r();
    const restore = vi.fn((): never => { throw new Error('out of memory'); }) as unknown as RestoreDeps['restore'];
    expect(restoreForRejoin(p.config, p.verified, { restore })).toEqual({ ok: false, reason: 'restore_threw' });
  });
});

/** The header's matchDigest, read independently of the code under test. */
function readDigest(raw: Uint8Array): number {
  // magic 4 + format 2 + schema digest 4 = offset 10 (the layout `snapshot-wire.test.ts` pins).
  return new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(10, true);
}

describe('restoreForRejoin: the bytes must be the ones that were verified, checked before anything is written', () => {
  it('a verified.frameTick the header does not hold is refused, and restoreSim is never called', () => {
    const p = room('mirror');
    const restore = vi.fn();
    // 2,399 is a snapshot tick too, so only the header comparison can refuse it.
    expect(restoreForRejoin(p.config, { ...p.verified, frameTick: 2399 }, { restore: restore as unknown as RestoreDeps['restore'] })).toEqual({ ok: false, reason: 'refused' });
    expect(restore).not.toHaveBeenCalled();
  });
  it('a verified.matchDigest the header does not hold is refused, and restoreSim is never called', () => {
    const p = room('mirror');
    const restore = vi.fn();
    expect(restoreForRejoin(p.config, { ...p.verified, matchDigest: (p.verified.matchDigest + 1) >>> 0 }, { restore: restore as unknown as RestoreDeps['restore'] })).toEqual({ ok: false, reason: 'refused' });
    expect(restore).not.toHaveBeenCalled();
  });
  it('a snapshot written by another build than the room\'s is refused, and restoreSim is never called', () => {
    const p = room('mirror');
    const restore = vi.fn();
    expect(restoreForRejoin({ ...p.config, build: 'b-2' }, p.verified, { restore: restore as unknown as RestoreDeps['restore'] })).toEqual({ ok: false, reason: 'refused' });
    expect(restore).not.toHaveBeenCalled();
  });
  it('bytes that are not a snapshot at all are refused', () => {
    const p = room('mirror');
    expect(restoreForRejoin(p.config, { ...p.verified, raw: new Uint8Array(100) })).toEqual({ ok: false, reason: 'refused' });
  });
});

describe('settleRejoin', () => {
  const snapshotOf = (name: 'mirror' | 'economy'): Prepared => ({ path: 'snapshot', verified: room(name).verified });

  it('a snapshot that restores: the restored world, path snapshot from 1,200, and restartFromZero is never called', () => {
    for (const name of ['mirror', 'economy'] as const) {
      const p = room(name);
      const restartFromZero = vi.fn();
      const s = settleRejoin(p.config, snapshotOf(name), { restartFromZero });
      expect(s.rejoin).toMatchObject({ path: 'snapshot', from: 1200 });
      expect(s.world).not.toBeNull();
      expect(s.world?.sim.tickCount).toBe(1200);
      expect(restartFromZero).not.toHaveBeenCalled();
    }
  });
  it('a post failure restarts from zero exactly once and returns a FRESH world, never the touched one', () => {
    const p = room('mirror');
    const restartFromZero = vi.fn();
    const built: MatchWorld[] = [];
    const deps: RestoreDeps = {
      build: (c) => { const w = buildMatchWorld(c); built.push(w); return w; },
      // Writes the world (a real restore) and then fails: the half-restored shape.
      restore: (sim, bytes, runtime) => { restoreSim(sim, bytes, runtime); throw new Error('after the write'); },
    };
    const s = settleRejoin(p.config, { path: 'snapshot', verified: p.verified }, { restartFromZero }, deps);
    expect(s.rejoin).toEqual({ path: 'full', reason: 'restore_threw' });
    expect(restartFromZero).toHaveBeenCalledTimes(1);
    expect(built).toHaveLength(2);
    const touched = built[0];
    expect(touched?.sim.tickCount).toBe(1200); // the first world carries the restored state
    expect(s.world).toBe(built[1]);
    expect(s.world).not.toBe(touched);
    expect(s.world?.sim.tickCount).toBe(0);
    expect(s.world?.sim.hash()).toBe(buildMatchWorld(p.config).sim.hash());
  });
  it('every post reason through settleRejoin is a full path with that reason, a fresh world and one restart', () => {
    const p = room('mirror');
    const cases: [PostCase, MatchConfig, Verified][] = [
      ['cadence_off', { ...p.config, snapshotEveryTicks: 0 }, p.verified],
      ['config_match_mismatch', { ...p.config, matchId: 'ZZZZZZ' }, p.verified],
      ['refused', p.config, { ...p.verified, raw: p.raw.slice(0, p.raw.length - 16) }],
    ];
    for (const [reason, config, verified] of cases) {
      const restartFromZero = vi.fn();
      const s = settleRejoin(config, { path: 'snapshot', verified }, { restartFromZero });
      expect(s.rejoin).toEqual({ path: 'full', reason });
      expect(s.world?.sim.tickCount).toBe(0);
      expect(restartFromZero).toHaveBeenCalledTimes(1);
    }
  });
  it('a sandbox room that was handed a snapshot restarts and keeps its own boot (world null)', () => {
    const p = room('mirror');
    const restartFromZero = vi.fn();
    const s = settleRejoin({ ...p.config, mode: 'sandbox' }, snapshotOf('mirror'), { restartFromZero });
    expect(s).toEqual({ world: null, rejoin: { path: 'full', reason: 'not_versus' } });
    expect(restartFromZero).toHaveBeenCalledTimes(1);
  });
  it('a pre-hello fallback keeps its reason, builds a fresh versus world and does not restart', () => {
    const p = room('mirror');
    const restartFromZero = vi.fn();
    const s = settleRejoin(p.config, { path: 'full', reason: 'none' }, { restartFromZero });
    expect(s.rejoin).toEqual({ path: 'full', reason: 'none' });
    expect(s.world?.sim.tickCount).toBe(0);
    expect(restartFromZero).not.toHaveBeenCalled();
    const sandbox = settleRejoin({ ...p.config, mode: 'sandbox' }, { path: 'full', reason: 'timeout' }, { restartFromZero });
    expect(sandbox).toEqual({ world: null, rejoin: { path: 'full', reason: 'timeout' } });
    expect(restartFromZero).not.toHaveBeenCalled();
  });
  it('no rejoin at all (a fresh create or join): a fresh world and rejoin null', () => {
    const p = room('mirror');
    const restartFromZero = vi.fn();
    const s = settleRejoin(p.config, undefined, { restartFromZero });
    expect(s.rejoin).toBeNull();
    expect(s.world?.sim.tickCount).toBe(0);
    expect(restartFromZero).not.toHaveBeenCalled();
  });
});

type PostCase = 'cadence_off' | 'config_match_mismatch' | 'refused';
