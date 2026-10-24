// Two real sims on a real mission, fed ONE frame stream through the lockstep
// core, hashed every tick. The multiplayer sibling of `test:determinism`
// (spec §12). Runs under `pnpm test` (the `gates` job).
import { describe, it, expect } from 'vitest';
import { fx } from '@lions/sim';
import type { Command } from '@lions/sim';
import { LockstepClock, applyFrame, canonicalOrder, cleanCommand, matchDigest, type Frame, type MatchTransport, type SeatWorld, type Stamped, type TransportStatus } from '@lions/net';
import { missionWorld } from '../mission-harness';
import { buildWorld } from '../../../packages/app/src/net/versus-world.test-helper';
import { versusSpawns } from '../../../packages/app/src/net/versus-force';
import { versusAnchors } from '../../../packages/app/src/net/versus-seats';
import { buildMatchWorld, matchTick } from '../../../packages/app/src/net/match-world';
import { harnessTick } from './agent-client';
import { FogTracker } from './fog-tracker';
import { runFrames, seatWorldFor, type FrameStep } from '../../../packages/app/src/net/frame-step';
import { versusConfig } from './test-config';
import { simIntentWorld } from '../../../packages/app/src/input/pointer';
import { applyIntent } from '../../../packages/app/src/input/intents';
import { beginPatrol, patrolClick } from '../../../packages/app/src/input/patrol';
import { contentDigest, shippedContent, shippedContentDigest } from '../../../packages/app/src/net/content-digest';
import { units } from '@lions/data';
import {
  ECONOMY_STREAM_ACCEPTED, ECONOMY_STREAM_FORGED_TICK, ECONOMY_STREAM_TICKS, ECONOMY_STREAM_TUNNEL, economyStreamFrames, runEconomyClient,
} from '../../../packages/app/src/net/economy-stream.test-helper';

const MISSION = 'beit_sahwan_1_recon';
const TICKS = 1000;

interface SimView { width: number; height: number; structureCount: number; tunnelCount: number; entityCount: number; state: { side: Uint8Array; alive: Uint8Array } }

/** Both seats on side 0, as N0's sandbox room is. */
function worldFor(sim: SimView): SeatWorld {
  return {
    sideOfSeat: () => 0,
    versus: false,
    economy: false,
    sideOfEntity: (id) => (id >= 0 && id < sim.entityCount ? sim.state.side[id] : undefined),
    width: sim.width,
    height: sim.height,
    structureExists: (id) => Number.isInteger(id) && id >= 0 && id < sim.structureCount,
    tunnelExists: (id) => Number.isInteger(id) && id >= 0 && id < sim.tunnelCount,
    factionOfSeat: () => 'kdf',
    tunnelOwner: () => -1,
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
    const anchors = versusAnchors(w.map);
    const { bySide } = versusSpawns(w.sim, w.typeOf, anchors);
    return { ...w, anchors, bySide };
  }

  function versusFrames(withSeat1Orders: boolean, extraFor?: (theirs: number[]) => [number, Stamped][]): Frame[] {
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
      ...(extraFor ? extraFor(theirs) : []),
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

  it('a setStance ambush is stamped and agreed on by both clients, not dropped, and it moves the hash (N2 L3)', () => {
    const at = (tick: number, seat: 0 | 1, seq: number, cmd: Command): [number, Stamped] => [tick, { seat, seq, cmd }];
    const frames = versusFrames(true, (theirs) => [
      at(12, 1, 9, { kind: 'setStance', ids: theirs.slice(0, 2), stance: 'ambush' }),
    ]);
    const a = runVersus(frames);
    const b = runVersus(frames);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.drops).toEqual([CRAFT_TICK]);
    const base = runVersus(versusFrames(true));
    expect(a.hashes[19]).not.toBe(base.hashes[19]);
  }, 60_000);

  it('a setStance patrol is stamped and agreed on by both clients, not dropped, and it moves the hash (N3 Task 9)', () => {
    const at = (tick: number, seat: 0 | 1, seq: number, cmd: Command): [number, Stamped] => [tick, { seat, seq, cmd }];
    const probe = versusWorld();
    const [hx, hy] = probe.anchors.hostile;
    // A beat round the hostile end, three points, all on the map.
    const beat: [number, number][] = [
      [fx.from(hx + 0.5), fx.from(hy + 0.5)],
      [fx.from(hx + 4.5), fx.from(hy + 0.5)],
      [fx.from(hx + 4.5), fx.from(hy + 4.5)],
    ];
    const frames = versusFrames(true, (theirs) => [
      at(12, 1, 9, { kind: 'setStance', ids: theirs.slice(0, 2), stance: 'patrol', waypoints: beat }),
    ]);
    const a = runVersus(frames);
    const b = runVersus(frames);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.drops).toEqual([CRAFT_TICK]);
    const base = runVersus(versusFrames(true));
    expect(a.hashes[19]).not.toBe(base.hashes[19]);
  }, 60_000);

  // Lane A mock (Q14, the lead, 22 Oct): the same beat, but drawn by the PLAYER's path --
  // `beginPatrol` (P pressed: point 1 where the pair stands), a Shift-click, a plain click, and
  // `applyIntent`'s command -- so the UI's own output is what both clients stamp and agree on.
  it('a patrol drawn through the UI path is one setStance both clients accept and agree on (Lane A Q14)', () => {
    const probe = versusWorld();
    const [hx, hy] = probe.anchors.hostile;
    const pair = probe.bySide[1].slice(0, 2);
    const world = simIntentWorld(probe.sim, () => false);
    /** The first open tile centre at or after (x, y), scanning right then down. */
    const openNear = (x: number, y: number): [number, number] => {
      for (let dy = 0; dy < 12; dy++) {
        for (let dx = 0; dx < 12; dx++) {
          const p: [number, number] = [Math.floor(x) + dx + 0.5, Math.floor(y) + dy + 0.5];
          if (world.groundAt(p[0], p[1]) === 'open') return p;
        }
      }
      throw new Error('no open tile near the hostile anchor');
    };
    const begun = beginPatrol(
      pair,
      (i) => ({ x: fx.toNumber(probe.sim.state.posX[i]), y: fx.toNumber(probe.sim.state.posY[i]) }),
      world,
      (i) => probe.sim.state.carriedBy[i] >= 0
    );
    if (typeof begun === 'string') throw new Error(`patrol refused: ${begun}`);
    const [ax, ay] = openNear(hx + 4, hy);
    const added = patrolClick(begun, world, ax, ay, true);
    if (added.kind !== 'added') throw new Error(`shift-click did not add: ${added.kind}`);
    const [bx, by] = openNear(hx + 4, hy + 4);
    const sent = patrolClick(added.draft, world, bx, by, false);
    if (sent.kind !== 'send') throw new Error(`plain click did not send: ${sent.kind}`);
    const cmds: Command[] = [];
    applyIntent({ queueCommand: (c) => cmds.push(c) }, sent.intent, { width: probe.sim.width, height: probe.sim.height });
    expect(cmds).toHaveLength(1);
    const cmd = cmds[0];
    // Literal oracle: the three points the player placed, as Q16.16 integers, in order.
    expect(cmd).toEqual({
      kind: 'setStance',
      ids: pair,
      stance: 'patrol',
      waypoints: [
        [fx.from(begun.points[0].x), fx.from(begun.points[0].y)],
        [fx.from(ax), fx.from(ay)],
        [fx.from(bx), fx.from(by)],
      ],
    });
    // And the room's own wire check rebuilds it unchanged (two integers per point, 2..4 points).
    expect(cleanCommand(JSON.parse(JSON.stringify(cmd)))).toEqual(cmd);
    const frames = versusFrames(true, () => [[12, { seat: 1, seq: 9, cmd }]]);
    const a = runVersus(frames);
    const b = runVersus(frames);
    expect(a.hashes).toEqual(b.hashes);
    // Only the crafted command drops: the UI's patrol passed `validateCommand` on both clients.
    expect(a.drops).toEqual([CRAFT_TICK]);
    expect(a.hashes[19]).not.toBe(runVersus(versusFrames(true)).hashes[19]);
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
    // L4: each client folds its OWN content digest, never the room-minted one.
    for (const [tick, d] of a.feed.digests) {
      expect(d).toBe(matchDigest(a.feed.simHashes.get(tick) ?? NaN, 0, shippedContentDigest()));
    }
  }, 60_000);

  it('a runtime digest one client does not share is a desync on the first hash tick (19)', () => {
    const a = client();
    const b = client((sim) => ({ runtimeDigest: () => sim.tickCount }));
    // The sims agree: only the runtime digest differs.
    expect([...b.feed.simHashes]).toEqual([...a.feed.simHashes]);
    expect(firstDisagreement(a.feed.digests, b.feed.digests)).toBe(19);
  }, 60_000);

  it('L4: a client whose content has one unit\'s hp changed desyncs at the first hash tick (19)', () => {
    const inf = units.inf_squad;
    const changed = contentDigest({ ...shippedContent(), units: { ...units, inf_squad: { ...inf, hull: { ...inf.hull, hp: inf.hull.hp + 1 } } } });
    const a = client();
    const b = client(() => ({ dataDigest: changed }));
    // An inf_squad's hp moves nothing before the forces meet: the sims agree,
    // and only the data digest can see the two clients are not on one build.
    expect([...b.feed.simHashes]).toEqual([...a.feed.simHashes]);
    expect(firstDisagreement(a.feed.digests, b.feed.digests)).toBe(19);
  }, 60_000);
});

// N3 Task 3: a KDF-v-Sarim room runs an economy runtime, and both the browser's room path
// (`main.ts`: `matchTick`, the world runtime's digest) and the AI harness (`harnessTick`) must
// report one digest. Builds stay direct calls in Task 3: the wire still drops `build` in versus.
describe('an economy room: two clients and the harness, one frame stream (N3 Task 3)', () => {
  const MAP = 'tel_marum';
  const ETICKS = 400;

  class Feed implements MatchTransport {
    readonly local = false;
    readonly digests = new Map<number, number>();
    private frames: Frame[];
    constructor(frames: Frame[]) { this.frames = [...frames]; }
    queueCommand(): void {}
    take(max: number): Frame[] { return this.frames.splice(0, max); }
    reportTick(tick: number, digest: number | null): void { if (digest !== null) this.digests.set(tick, digest); }
    status(): TransportStatus { return { kind: 'live', behind: this.frames.length }; }
    close(): void {}
  }

  /** The same stream the digest block above uses: both sides attack-move at the other's end. */
  function frames(bySide: [number[], number[]], anchors: { readonly friendly: readonly [number, number]; readonly hostile: readonly [number, number] }): Frame[] {
    const [hx, hy] = anchors.hostile;
    const [fx0, fy0] = anchors.friendly;
    return stream(new Map<number, Stamped[]>([
      [5, [
        { seat: 0, seq: 0, cmd: { kind: 'attackMove', ids: bySide[0], x: fx.from(hx + 0.5), y: fx.from(hy + 0.5) } },
        { seat: 1, seq: 0, cmd: { kind: 'attackMove', ids: bySide[1], x: fx.from(fx0 + 0.5), y: fx.from(fy0 + 0.5) } },
      ]],
    ]), ETICKS);
  }

  /** One client. `harness` runs the AI harness's tick; otherwise the browser's room body. */
  function client(harness: boolean) {
    const config = versusConfig(MAP, { factions: ['kdf', 'sarim'] });
    const w = buildMatchWorld(config);
    if (w.runtime === null) throw new Error('a kdf room must have a runtime');
    const rt = w.runtime;
    const feed = new Feed(frames(w.bySide, w.anchors));
    const body: Pick<FrameStep, 'runTick' | 'runtimeDigest'> = harness
      ? harnessTick(w, new FogTracker(w.sim, 1))
      : { runTick: () => { matchTick(w); }, runtimeDigest: () => rt.digest() };
    const step: FrameStep = { transport: feed, sim: w.sim, seatWorld: seatWorldFor(config, w.sim), config, ...body };
    // A direct build on each side between ticks (the wire is closed until Task 4).
    expect(runFrames(step, 30).ran).toBe(30);
    expect(rt.requestBuild('inf_squad', 0, 0)).toBe(true);
    expect(rt.requestBuild('atgm_cell', 0, 1)).toBe(true);
    expect(runFrames(step, ETICKS).ran).toBe(ETICKS - 30);
    return { feed, rt };
  }

  const firstDisagreement = (a: Map<number, number>, b: Map<number, number>): number | null => {
    for (const [tick, d] of [...a].sort(([p], [q]) => p - q)) if (b.get(tick) !== d) return tick;
    return null;
  };

  it('two browser clients report equal digests on every hash tick, with a non-zero runtime digest', () => {
    const a = client(false);
    const b = client(false);
    expect(a.feed.digests.size).toBe(ETICKS / 20);
    expect(firstDisagreement(a.feed.digests, b.feed.digests)).toBeNull();
    expect(a.rt.digest()).not.toBe(0);
  }, 60_000);

  it('the harness and the browser report the same digest on every hash tick', () => {
    const browser = client(false);
    const harness = client(true);
    expect(firstDisagreement(browser.feed.digests, harness.feed.digests)).toBeNull();
    expect(harness.feed.digests.size).toBe(ETICKS / 20);
  }, 60_000);
});

// N3 Task 8: both seats PRODUCE over the wire (Review Focus 2). A Sarim-host wadi_tarfan room
// (seat 0 Sarim on side 1, LD1); the stream and the client are shared with `net:engines`
// (`economy-stream.test-helper.ts`), so the browsers play exactly what is asserted here.
describe('an economy room: both seats producing through frames (N3 Task 8)', () => {
  const firstDisagreement = (a: readonly [number, number][], b: readonly [number, number][]): number | null => {
    const bm = new Map(b);
    for (const [tick, d] of a) if (bm.get(tick) !== d) return tick;
    return a.length === b.length ? null : -1;
  };
  const frames = economyStreamFrames();
  const a = runEconomyClient(frames);
  const b = runEconomyClient(frames);

  it('two clients report equal digests on every hash tick, and agree on what each side built', () => {
    expect(a.digests.length).toBe(ECONOMY_STREAM_TICKS / 20);
    expect(firstDisagreement(a.digests, b.digests)).toBeNull();
    expect(a.built).toEqual(b.built);
    expect(a.built[0]).toBeGreaterThan(0);
    expect(a.built[1]).toBeGreaterThan(0);
    expect(a.runtimeDigest).not.toBe(0);
    expect(a.purse).toEqual(b.purse);
    // Every runtime command in the stream reached the runtime and was accepted:
    // the builds, the cancel, both rallies set and both cleared.
    expect(a.accepted).toBe(ECONOMY_STREAM_ACCEPTED);
    expect(b.accepted).toBe(ECONOMY_STREAM_ACCEPTED);
  }, 60_000);

  it('the Sarim seat\'s foot units went below, crawled to the vent, and came up on order (GH-681 T6)', () => {
    expect(a.tunnel.below).toBe(2);
    expect(a.tunnel.surfaced).toBeGreaterThan(0);
    expect(b.tunnel).toEqual(a.tunnel);
  });

  it('falsified: the vent frame dropped from client B alone is a desync (GH-681 T6)', () => {
    const cut = frames.map((f) => (f.tick === ECONOMY_STREAM_TUNNEL.exit ? { tick: f.tick, cmds: f.cmds.filter((s) => s.cmd.kind !== 'vent') } : f));
    expect(cut[ECONOMY_STREAM_TUNNEL.exit].cmds.length).toBe(frames[ECONOMY_STREAM_TUNNEL.exit].cmds.length - 1);
    const bad = runEconomyClient(cut);
    expect(firstDisagreement(a.digests, bad.digests)).not.toBeNull();
    expect(bad.tunnel).not.toEqual(a.tunnel);
  }, 60_000);

  it('the forged build{side: 0} from seat 0 (side 1) is dropped on both clients, and only it', () => {
    // The forged build, and seat 1's forged enterTunnel into the Sarim route (T-R4).
    expect(a.droppedTicks).toEqual([ECONOMY_STREAM_TUNNEL.forged, ECONOMY_STREAM_FORGED_TICK]);
    expect(b.droppedTicks).toEqual([ECONOMY_STREAM_TUNNEL.forged, ECONOMY_STREAM_FORGED_TICK]);
  });

  it('falsified: a frame out of order on client B is a desync on that window\'s hash tick', () => {
    // Swap the frames of ticks 5 and 6 (each carries one seat's opening builds):
    // B runs Sarim's builds before KDF's, a tick early.
    const swapped = [...frames];
    [swapped[5], swapped[6]] = [swapped[6], swapped[5]];
    const bad = runEconomyClient(swapped);
    expect(firstDisagreement(a.digests, bad.digests)).toBe(19);
  }, 60_000);

  it('falsified: the cancelBuild dropped from client B alone is a desync by the next hash tick (59)', () => {
    const cut = frames.map((f) => (f.tick === 40 ? { tick: 40, cmds: f.cmds.filter((s) => s.cmd.kind !== 'cancelBuild') } : f));
    expect(cut[40].cmds.length).toBe(frames[40].cmds.length - 1);
    const bad = runEconomyClient(cut);
    // The refund is in the purse, which the runtime digest folds: the window holding tick 40 closes at 59.
    expect(firstDisagreement(a.digests, bad.digests)).toBe(59);
  }, 60_000);
});
