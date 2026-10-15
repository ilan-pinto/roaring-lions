// Two real sims on a real mission, fed ONE frame stream through the lockstep
// core, hashed every tick. The multiplayer sibling of `test:determinism`
// (spec §12). Runs under `pnpm test` (the `gates` job).
import { describe, it, expect } from 'vitest';
import { fx } from '@lions/sim';
import type { Command } from '@lions/sim';
import { LockstepClock, applyFrame, canonicalOrder, matchDigest, type Frame, type MatchTransport, type SeatWorld, type Stamped, type TransportStatus } from '@lions/net';
import { missionWorld } from '../mission-harness';
import { buildWorld } from '../../../packages/app/src/net/versus-world.test-helper';
import { versusSpawns } from '../../../packages/app/src/net/versus-force';
import { sandboxAnchors } from '../../../packages/app/src/sandbox-anchors';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import { runFrames, seatWorldFor, type FrameStep } from '../../../packages/app/src/net/frame-step';
import { versusConfig } from './test-config';

const MISSION = 'beit_sahwan_1_recon';
const TICKS = 1000;

interface SimView { width: number; height: number; structureCount: number; tunnelCount: number; entityCount: number; state: { side: Uint8Array; alive: Uint8Array } }

/** Both seats on side 0, as N0's sandbox room is. */
function worldFor(sim: SimView): SeatWorld {
  return {
    sideOfSeat: () => 0,
    versus: false,
    sideOfEntity: (id) => (id >= 0 && id < sim.entityCount ? sim.state.side[id] : undefined),
    width: sim.width,
    height: sim.height,
    structureExists: (id) => Number.isInteger(id) && id >= 0 && id < sim.structureCount,
    tunnelExists: (id) => Number.isInteger(id) && id >= 0 && id < sim.tunnelCount,
  };
}

/** A canned order script: every player unit marches to a few points. */
function script(playerIds: readonly number[]): Map<number, Stamped[]> {
  const at = (tick: number, seat: 0 | 1, seq: number, cmd: Command): [number, Stamped] => [tick, { seat, seq, cmd }];
  const half = Math.ceil(playerIds.length / 2);
  const a = playerIds.slice(0, half);
  const b = playerIds.slice(half);
  const entries: [number, Stamped][] = [
    at(10, 0, 0, { kind: 'move', ids: a, x: fx.from(20.5), y: fx.from(20.5) }),
    at(10, 1, 0, { kind: 'move', ids: b, x: fx.from(26.5), y: fx.from(18.5) }),
    at(300, 1, 1, { kind: 'attackMove', ids: b, x: fx.from(30.5), y: fx.from(24.5) }),
    at(300, 0, 1, { kind: 'halt', ids: a }),
    at(600, 0, 2, { kind: 'attackMove', ids: a, x: fx.from(32.5), y: fx.from(22.5) }),
  ];
  const byTick = new Map<number, Stamped[]>();
  for (const [tick, s] of entries) byTick.set(tick, [...(byTick.get(tick) ?? []), s]);
  return byTick;
}

function stream(byTick: Map<number, Stamped[]>, ticks: number): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < ticks; t++) frames.push({ tick: t, cmds: canonicalOrder(byTick.get(t) ?? []) });
  return frames;
}

function playerIdsOf(sim: SimView): number[] {
  const ids: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) ids.push(i);
  return ids;
}

function run(frames: Frame[], onTick: (tick: number, hash: number) => void): void {
  const w = missionWorld(MISSION, {});
  const clock = new LockstepClock(0);
  const world = worldFor(w.sim);
  for (const f of frames) {
    expect(clock.push(f)).toBe('ok');
    for (const ready of clock.take(1)) {
      applyFrame(ready, w.sim, world);
      w.runtime.step(w.sim.tick());
      onTick(ready.tick, w.sim.hash());
    }
  }
}

describe('two clients, one frame stream', () => {
  it('agree on every tick for 1000 ticks', () => {
    const probe = missionWorld(MISSION, {});
    const frames = stream(script(playerIdsOf(probe.sim)), TICKS);
    const a: number[] = [];
    const b: number[] = [];
    run(frames, (_, h) => a.push(h));
    run(frames, (_, h) => b.push(h));
    expect(a.length).toBe(TICKS);
    expect(a).toEqual(b);
    // The script did something: the state is not the idle state.
    const idle: number[] = [];
    run(stream(new Map(), TICKS), (_, h) => idle.push(h));
    expect(a[TICKS - 1]).not.toBe(idle[TICKS - 1]);
  }, 60_000);   // 3.2-5.4 s alone; the 5 s default timed out under load

  it('a dropped command on one side is visible to the instrument by the next hash', () => {
    const probe = missionWorld(MISSION, {});
    const frames = stream(script(playerIdsOf(probe.sim)), 40);
    const cut = frames.map((f) => (f.tick === 10 ? { tick: 10, cmds: f.cmds.slice(1) } : f));
    const a = new Map<number, number>();
    const b = new Map<number, number>();
    run(frames, (t, h) => a.set(t, h));
    run(cut, (t, h) => b.set(t, h));
    expect(a.get(9)).toBe(b.get(9));
    expect(a.get(20)).not.toBe(b.get(20));
  });

  it('an out-of-order frame is refused and runs nothing', () => {
    const clock = new LockstepClock(0);
    expect(clock.push({ tick: 0, cmds: [] })).toBe('ok');
    expect(clock.push({ tick: 2, cmds: [] })).toBe('gap');
    expect(clock.push({ tick: 0, cmds: [] })).toBe('duplicate');
    expect(clock.take(10).map((f) => f.tick)).toEqual([0]);
    expect(clock.push({ tick: 0, cmds: [] })).toBe('duplicate');
    expect(clock.take(10)).toEqual([]);
  });
});

// N1a: the same claim with the two seats on OPPOSITE sides of one bare world.
describe('versus: two sides, one frame stream', () => {
  const MAP = 'beit_sahwan_outskirts';
  const VTICKS = 1000;
  const CRAFT_TICK = 50;

  /** The mirror-match world: Task 7's bare Sim plus both forces. */
  function versusWorld() {
    const w = buildWorld(MAP);
    const anchors = sandboxAnchors(w.map);
    const { bySide } = versusSpawns(w.sim, w.typeOf, anchors);
    return { ...w, anchors, bySide };
  }

  function versusFrames(withSeat1Orders: boolean): Frame[] {
    const probe = versusWorld();
    const [fx0, fy0] = probe.anchors.friendly;
    const [hx, hy] = probe.anchors.hostile;
    const at = (tick: number, seat: 0 | 1, seq: number, cmd: Command): [number, Stamped] => [tick, { seat, seq, cmd }];
    const [mine, theirs] = probe.bySide;
    const entries: [number, Stamped][] = [
      // Seat 0 marches side 0 at the hostile camp.
      at(10, 0, 0, { kind: 'attackMove', ids: mine, x: fx.from(hx + 0.5), y: fx.from(hy + 0.5) }),
      // Seat 1 marches side 1 at the friendly camp, and later halts, then charges.
      ...(withSeat1Orders
        ? [
            at(10, 1, 0, { kind: 'attackMove', ids: theirs, x: fx.from(fx0 + 0.5), y: fx.from(fy0 + 0.5) }),
            // Crafted: seat 1 names a side-0 unit. Every client must drop it.
            at(CRAFT_TICK, 1, 1, { kind: 'move', ids: [mine[0]], x: fx.from(2.5), y: fx.from(2.5) }),
            at(400, 1, 2, { kind: 'halt', ids: theirs }),
            at(600, 1, 3, { kind: 'attackMove', ids: theirs, x: fx.from(fx0 + 0.5), y: fx.from(fy0 + 0.5) }),
          ]
        : []),
      at(300, 0, 1, { kind: 'halt', ids: mine }),
      at(500, 0, 2, { kind: 'attackMove', ids: mine, x: fx.from(hx + 0.5), y: fx.from(hy + 0.5) }),
    ];
    const byTick = new Map<number, Stamped[]>();
    for (const [tick, s] of entries) byTick.set(tick, [...(byTick.get(tick) ?? []), s]);
    return stream(byTick, VTICKS);
  }

  /** One client: its own world, the shared frame stream, a hash and the drops per tick. */
  function runVersus(frames: Frame[], sideOfSeat: (s: number) => number = (s) => s) {
    const w = versusWorld();
    const clock = new LockstepClock(0);
    const world: SeatWorld = { ...worldFor(w.sim), sideOfSeat };
    const hashes: number[] = [];
    const drops: number[] = [];
    for (const f of frames) {
      expect(clock.push(f)).toBe('ok');
      for (const ready of clock.take(1)) {
        const r = applyFrame(ready, w.sim, world);
        if (r.dropped > 0) for (let i = 0; i < r.dropped; i++) drops.push(ready.tick);
        w.sim.tick();
        hashes.push(w.sim.hash());
      }
    }
    return { hashes, drops };
  }

  it('two clients on opposite sides agree on every tick, and drop the crafted command identically', () => {
    const frames = versusFrames(true);
    const a = runVersus(frames);
    const b = runVersus(frames);
    expect(a.hashes.length).toBe(VTICKS);
    expect(a.hashes).toEqual(b.hashes);
    // Exactly one drop, at tick 50, on both runs.
    expect(a.drops).toEqual([CRAFT_TICK]);
    expect(b.drops).toEqual([CRAFT_TICK]);
    // The orders did something: without seat 1's orders the final state differs.
    const without = runVersus(versusFrames(false));
    expect(without.hashes[VTICKS - 1]).not.toBe(a.hashes[VTICKS - 1]);
  }, 60_000);

  it('the crafted command is dropped for ownership, not for being malformed', () => {
    // Control: if seat 1 were on side 0 the crafted order (it names a side-0
    // unit, on the map) is accepted; its own side-1 orders are what drop.
    const r = runVersus(versusFrames(true), () => 0);
    expect(r.drops).not.toContain(CRAFT_TICK);
    expect(r.drops.length).toBeGreaterThan(0);
  }, 60_000);
});

// N2-P2: what a client REPORTS on a hash tick, through the battlefield's own
// `runFrames` -- the sim hash folded with the runtime digest (absent: 0) and
// the data digest. Two clients that agree on the sim but not on the runtime
// must be a desync on the first hash tick, or the seam is not wired.
describe('the reported match digest (runFrames)', () => {
  const MAP = 'beit_sahwan_outskirts';
  const RTICKS = 60;

  /** A room stand-in that hands out a fixed stream and records each digest
   *  beside the sim hash it was taken over. */
  class Feed implements MatchTransport {
    readonly local = false;
    readonly digests = new Map<number, number>();
    readonly simHashes = new Map<number, number>();
    private frames: Frame[];
    constructor(frames: Frame[], private readonly sim: { hash(): number }) { this.frames = [...frames]; }
    queueCommand(): void {}
    take(max: number): Frame[] { return this.frames.splice(0, max); }
    reportTick(tick: number, digest: number | null): void {
      if (digest === null) return;
      this.digests.set(tick, digest);
      this.simHashes.set(tick, this.sim.hash());
    }
    status(): TransportStatus { return { kind: 'live', behind: this.frames.length }; }
    close(): void {}
  }

  function framesFor(bySide: [number[], number[]], anchors: { readonly friendly: readonly [number, number]; readonly hostile: readonly [number, number] }): Frame[] {
    const [hx, hy] = anchors.hostile;
    const [fx0, fy0] = anchors.friendly;
    const byTick = new Map<number, Stamped[]>([
      [5, [
        { seat: 0, seq: 0, cmd: { kind: 'attackMove', ids: bySide[0], x: fx.from(hx + 0.5), y: fx.from(hy + 0.5) } },
        { seat: 1, seq: 0, cmd: { kind: 'attackMove', ids: bySide[1], x: fx.from(fx0 + 0.5), y: fx.from(fy0 + 0.5) } },
      ]],
    ]);
    return stream(byTick, RTICKS);
  }

  /** One client: its own world, the shared stream, `runFrames` as the browser and the harness call it. */
  function client(extra: (sim: { tickCount: number }) => Partial<FrameStep> = () => ({})) {
    const config = versusConfig(MAP);
    const w = buildMatchWorld(config);
    const feed = new Feed(framesFor(w.bySide, w.anchors), w.sim);
    const step: FrameStep = { transport: feed, sim: w.sim, seatWorld: seatWorldFor(config, w.sim), runTick: () => w.sim.tick(), config, ...extra(w.sim) };
    expect(runFrames(step, RTICKS).ran).toBe(RTICKS);
    return { feed, config };
  }

  const firstDisagreement = (a: Map<number, number>, b: Map<number, number>): number | null => {
    for (const [tick, d] of [...a].sort(([p], [q]) => p - q)) if (b.get(tick) !== d) return tick;
    return null;
  };

  it('two clients report the same digest on every hash tick; with no runtime digest it folds 0', () => {
    const a = client();
    const b = client();
    expect([...a.feed.digests.keys()]).toEqual([19, 39, 59]);
    expect(firstDisagreement(a.feed.digests, b.feed.digests)).toBeNull();
    for (const [tick, d] of a.feed.digests) {
      expect(d).toBe(matchDigest(a.feed.simHashes.get(tick) ?? NaN, 0, a.config.dataDigest));
    }
  }, 60_000);

  it('a runtime digest one client does not share is a desync on the first hash tick (19)', () => {
    const a = client();
    const b = client((sim) => ({ runtimeDigest: () => sim.tickCount }));
    // The sims agree: only the runtime digest differs.
    expect([...b.feed.simHashes]).toEqual([...a.feed.simHashes]);
    expect(firstDisagreement(a.feed.digests, b.feed.digests)).toBe(19);
  }, 60_000);
});
