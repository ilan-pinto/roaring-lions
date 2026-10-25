import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { ECONOMY_SEED, RIFLES, RUN_SEED, economyAdvance, economyDrive, economySetup, reliefDrive, reliefSetup, runDrive, runSetup } from './golden-worlds.test-helper';
import { Rng } from './rng';
import { MAX_FLOW_FIELDS, POOL_RESTORE_BUDGET_BYTES, STRIKE_SNAPSHOT_KEYS, Sim, type Command, type UnitTypeJson } from './sim';
import { SIM_SNAPSHOT_SCHEMA, rowsOf } from './snapshot-schema';
import { SNAPSHOT_FIXED_HEADER_BYTES, SNAPSHOT_FORMAT, SNAPSHOT_MATCH_DIGEST_OFFSET, SnapshotRefused, canonicalJson, encodeSim, restoreSim, snapshotSchemaDigest } from './snapshot';
import { forkWitness } from './snapshot-witness';
import * as simIndex from './index';

// The encoder and the restore (net sim snapshot S1, Task 3). The worlds are the
// golden replay's: the 1000-tick battle (a shed collapses at tick 116, so
// the masks change mid-run), built by `runSetup` and driven by `runDrive`, both
// moved verbatim out of determinism.test.ts. The fork: step world A to tick T,
// build a FRESH world with the same setup at tick 0, restore A's bytes onto it.

const SEED = 0x1234;
const props = (o: unknown): Record<string, unknown> => o as Record<string, unknown>;

function advance(w: { sim: Sim; ids: ReturnType<typeof runSetup>['ids'] }, from: number, to: number): void {
  for (let t = from; t < to; t++) {
    runDrive(w.sim, t, w.ids);
    w.sim.tick();
  }
}

/** The golden world with a few boulder tiles, so `blockedVehicleMask` is its own array. */
function boulderSetup(seed: number): ReturnType<typeof runSetup> {
  const w = runSetup(seed);
  for (const [x, y] of [[10, 40], [11, 40], [10, 41], [14, 5]]) w.sim.setBoulder(x, y, true);
  return w;
}

/**
 * Puts something in every aux container, the way a boundary between frames can: a spawn
 * outside `tick` raises a real event, and a fire event (nested breakdown, an optional field)
 * and a pending strike are pushed as the sim would have.
 */
function withPending(sim: Sim): void {
  sim.spawn(0, 0, fx.fromInt(3), fx.fromInt(3));
  const events = props(sim).pendingEvents as unknown[];
  events.push({
    kind: 'fire', tick: sim.tickCount, shooter: 1, target: -1, structure: 0, weaponId: 'w', pHit: 40000, roll: 12, willHit: true,
    breakdown: { accuracy: 1, rangeFalloff: 2, coverMod: 3, motionMod: 4, stanceMod: 5, suppressionMod: 6 },
  });
  (props(sim).pendingStrikes as unknown[]).push({ x: 65536, y: 131072, by: 2, readyTick: sim.tickCount + 40, profile: 1 });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function refusal(fn: () => unknown): SnapshotRefused {
  try {
    fn();
  } catch (e) {
    expect(e, 'a refusal, not any other error').toBeInstanceOf(SnapshotRefused);
    return e as SnapshotRefused;
  }
  throw new Error('expected SnapshotRefused, nothing was thrown');
}

describe('snapshot: round trip, encode(restore(fresh, S)) == S', () => {
  const run = (label: string, setup: (seed: number) => ReturnType<typeof runSetup>, ticks: readonly number[]): void => {
    it(label, () => {
      const a = setup(SEED);
      let at = 0;
      for (const T of ticks) {
        advance(a, at, T);
        at = T;
        const S = encodeSim(a.sim);
        const fresh = setup(SEED).sim;
        const before = encodeSim(fresh);
        const aliased = props(fresh).posX;
        const viewPosX = fresh.state.posX;
        const viewStHp = fresh.structures.hp;
        restoreSim(fresh, S);
        expect(bytesEqual(encodeSim(fresh), S), `tick ${T}: re-encode`).toBe(true);
        if (T > 0) expect(bytesEqual(before, S), `tick ${T}: the fresh world already equalled the snapshot, so the test proves nothing`).toBe(false);
        expect(fresh.tickCount).toBe(T);
        expect(fresh.hash(), `tick ${T}: hash`).toBe(a.sim.hash());
        expect(props(fresh).posX, 'columns are written in place, so views stay aliased').toBe(aliased);
        // The read-only views the renderer holds, guarded directly: still the private arrays, not copies.
        expect(fresh.state.posX).toBe(viewPosX);
        expect(fresh.state.posX).toBe(props(fresh).posX);
        expect(fresh.structures.hp).toBe(viewStHp);
        expect(fresh.structures.hp).toBe(props(fresh).stHp);
      }
    });
  };

  run('ticks 0, 1, 137, 500 and 1000 of the 1000-tick world', runSetup, [0, 1, 137, 500, 1000]);

  it('a world with boulders: blockedVehicleMask is a distinct array, and both are written in place', () => {
    const a = boulderSetup(SEED);
    expect(props(a.sim).blockedVehicleMask).not.toBe(props(a.sim).blocked);
    advance(a, 0, 400);
    const S = encodeSim(a.sim);
    const fresh = boulderSetup(SEED).sim;
    const mask = props(fresh).blockedVehicleMask;
    const blocked = props(fresh).blocked;
    restoreSim(fresh, S);
    expect(props(fresh).blockedVehicleMask).toBe(mask);
    expect(props(fresh).blocked).toBe(blocked);
    expect(mask).not.toBe(blocked);
    expect(bytesEqual(encodeSim(fresh), S)).toBe(true);
    // The mask really differs from `blocked` (the boulders), and survived the trip.
    expect(Array.from(props(fresh).blockedVehicleMask as Uint8Array)).toEqual(Array.from(props(a.sim).blockedVehicleMask as Uint8Array));
    expect(Array.from(props(fresh).blockedVehicleMask as Uint8Array)).not.toEqual(Array.from(props(fresh).blocked as Uint8Array));
  });

  it('a world without boulders keeps blockedVehicleMask aliased to blocked', () => {
    const a = runSetup(SEED);
    advance(a, 0, 400);
    const fresh = runSetup(SEED).sim;
    restoreSim(fresh, encodeSim(a.sim));
    expect(props(fresh).blockedVehicleMask).toBe(props(fresh).blocked);
  });

  it('pending events and strikes are carried, every kind generically', () => {
    const a = runSetup(SEED);
    advance(a, 0, 137);
    withPending(a.sim);
    const events = props(a.sim).pendingEvents as { kind: string }[];
    expect(events.map((e) => e.kind)).toEqual(['spawn', 'fire']);
    const fresh = runSetup(SEED).sim;
    restoreSim(fresh, encodeSim(a.sim));
    expect(props(fresh).pendingEvents).toEqual(events);
    expect(props(fresh).pendingStrikes).toEqual(props(a.sim).pendingStrikes);
    const tiles = props(a.sim).stTiles as number[][];
    expect(tiles.length).toBeGreaterThan(0);
    expect(props(fresh).stTiles).toEqual(tiles);
  });

  it('a strike from the REAL path (callStrike through the command queue and a tick) is carried', () => {
    const a = runSetup(SEED);
    advance(a, 0, 20);
    a.sim.queueCommand({ kind: 'callStrike', caller: a.ids.west[0], x: fx.fromInt(30), y: fx.fromInt(24) });
    a.sim.tick();
    const strikes = props(a.sim).pendingStrikes as { by: number }[];
    expect(strikes.length, 'a strike is in the air at the boundary').toBeGreaterThan(0);
    expect(strikes[0].by).toBe(a.ids.west[0]);
    const S = encodeSim(a.sim);
    const fresh = runSetup(SEED).sim;
    restoreSim(fresh, S);
    expect(props(fresh).pendingStrikes).toEqual(strikes);
    expect(bytesEqual(encodeSim(fresh), S)).toBe(true);
    // The decoder's key list is the sim's own tuple: the keys of the real strike are exactly it.
    expect(Object.keys(strikes[0]).sort()).toEqual([...STRIKE_SNAPSHOT_KEYS].sort());
  });

  it('hands the meta back as written', () => {
    const a = runSetup(SEED);
    advance(a, 0, 5);
    const meta = { build: 'b-1.2.3', contentDigest: 0xdeadbeef, matchId: 'room-é-7', frameTick: 1199, matchDigest: 0xffffffff };
    const got = restoreSim(runSetup(SEED).sim, encodeSim(a.sim, meta));
    expect(got).toEqual(meta);
    expect(restoreSim(runSetup(SEED).sim, encodeSim(a.sim))).toEqual({ build: '', contentDigest: 0, matchId: '', frameTick: 0, matchDigest: 0 });
  });
});

describe('snapshot: the byte order is little-endian, pinned', () => {
  it('a known i32 scalar is written low byte first', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    props(sim).tickCount = 0x01020304;
    const bytes = encodeSim(sim);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toContain('04030201');
    expect(hex).not.toContain('01020304');
    // The header: magic, then the format as a little-endian u16.
    expect(Array.from(bytes.subarray(0, 6))).toEqual([0x52, 0x4c, 0x53, 0x53, SNAPSHOT_FORMAT, 0]);
  });
});

describe('snapshot: the header is fixed-width first, so the room can read matchDigest without a decoder', () => {
  const u32At = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);

  it('matchDigest sits at SNAPSHOT_MATCH_DIGEST_OFFSET, whatever the build and matchId say', () => {
    const sim = runSetup(SEED).sim;
    expect(SNAPSHOT_MATCH_DIGEST_OFFSET).toBe(10);
    const digest = 0xdeadbeef;
    const none = encodeSim(sim, { matchDigest: digest });
    const long = encodeSim(sim, { matchDigest: digest, build: 'b'.repeat(200), matchId: 'm'.repeat(250), contentDigest: 7, frameTick: 9 });
    expect(u32At(none, SNAPSHOT_MATCH_DIGEST_OFFSET)).toBe(digest);
    expect(u32At(long, SNAPSHOT_MATCH_DIGEST_OFFSET)).toBe(digest);
    // The first length word (the build's) follows the fixed part, so a longer string moves nothing before it.
    expect(long[SNAPSHOT_FIXED_HEADER_BYTES] | (long[SNAPSHOT_FIXED_HEADER_BYTES + 1] << 8)).toBe(200);
    // A neighbour's value does not leak into the word: the digest alone, then everything else.
    expect(u32At(encodeSim(sim, { contentDigest: 0x11111111, frameTick: 0x22222222 }), SNAPSHOT_MATCH_DIGEST_OFFSET)).toBe(0);
  });

  it('the decoder returns the same meta from the new layout', () => {
    const sim = runSetup(SEED).sim;
    const meta = { build: 'b1', contentDigest: 5, matchId: 'room-7', frameTick: 3, matchDigest: 0xfeedface };
    expect(restoreSim(runSetup(SEED).sim, encodeSim(sim, meta))).toEqual(meta);
  });
});

/** One command of every kind, typed so a kind missing here (or a field of the wrong type) fails to compile. */
const SAMPLE: { readonly [K in Command['kind']]: Extract<Command, { kind: K }> } = {
  move: { kind: 'move', ids: [0, 1], x: fx.fromInt(5), y: fx.fromInt(6), append: true, exact: false },
  attackMove: { kind: 'attackMove', ids: [2], x: fx.fromInt(7), y: fx.fromInt(8), sweep: true },
  halt: { kind: 'halt', ids: [0] },
  setStance: { kind: 'setStance', ids: [0, 1], stance: 'patrol', waypoints: [[fx.fromInt(3), fx.fromInt(4)], [fx.fromInt(9), fx.fromInt(4)]] },
  garrison: { kind: 'garrison', ids: [1], structure: 0 },
  load: { kind: 'load', ids: [1], carrier: 2 },
  unload: { kind: 'unload', ids: [2] },
  reveal: { kind: 'reveal', side: 0, x: fx.fromInt(10), y: fx.fromInt(10) },
  callStrike: { kind: 'callStrike', caller: 0, x: fx.fromInt(11), y: fx.fromInt(12), profile: 1 },
  smoke: { kind: 'smoke', ids: [3], x: fx.fromInt(13), y: fx.fromInt(14) },
  demolish: { kind: 'demolish', ids: [3], structure: 0 },
  chargeTunnel: { kind: 'chargeTunnel', ids: [3], tunnel: 0 },
  enterTunnel: { kind: 'enterTunnel', ids: [3], tunnel: 0 },
  vent: { kind: 'vent', ids: [3], mode: 'raid' },
  attack: { kind: 'attack', ids: [0], target: 4 },
  rescue: { kind: 'rescue', ids: [0], target: 5 },
  build: { kind: 'build', side: 0, unit: 'inf_squad', line: 1 },
  cancelBuild: { kind: 'cancelBuild', side: 0, line: 1, index: -1 },
  setRally: { kind: 'setRally', side: 0, line: 0, x: fx.fromInt(30), y: fx.fromInt(31) },
  clearRally: { kind: 'clearRally', side: 1, line: 0 },
  support: { kind: 'support', side: 0, support: 'mortar_barrage', x: fx.fromInt(20), y: fx.fromInt(21) },
  construct: { kind: 'construct', ids: [0], structType: 0, x: 12, y: 13 },
  cancelConstruct: { kind: 'cancelConstruct', site: 2 },
  raiseWorks: { kind: 'raiseWorks', side: 0, works: 'sandbag_wall', x: 14, y: 15, ids: [] },
  cancelWorks: { kind: 'cancelWorks', side: 0, site: 3 },
};
const SAMPLES: readonly Command[] = [
  ...Object.values(SAMPLE),
  { kind: 'setStance', ids: [0], stance: 'ambush', radius: fx.fromInt(4) },
  { kind: 'setStance', ids: [1], stance: 'hold' },
  { kind: 'vent', ids: [3], mode: 'exit' },
  { kind: 'build', side: 0, unit: 'supply_truck' },
];

describe('snapshot: the command and runtime queues are state', () => {
  const queued = (): { sim: Sim; w: ReturnType<typeof runSetup> } => {
    const w = runSetup(SEED);
    advance(w, 0, 137);
    for (const c of SAMPLES) w.sim.queueCommand(c);
    return { sim: w.sim, w };
  };

  it('a command of every kind, queued between two ticks, round trips byte-equal into the right queue', () => {
    const { sim } = queued();
    expect((props(sim).commandQueue as unknown[]).length, 'sim-run kinds').toBe(18 + 3);
    expect((props(sim).runtimeQueue as unknown[]).length, 'runtime-run kinds').toBe(7 + 1);
    const S = encodeSim(sim);
    const fresh = runSetup(SEED).sim;
    restoreSim(fresh, S);
    expect(bytesEqual(encodeSim(fresh), S), 're-encode').toBe(true);
    expect(props(fresh).commandQueue).toEqual(props(sim).commandQueue);
    expect(props(fresh).runtimeQueue).toEqual(props(sim).runtimeQueue);
    expect(fresh.hash()).toBe(sim.hash());
    expect(fresh.takeRuntimeCommands(), 'the runtime would take them in queue order').toEqual(sim.takeRuntimeCommands());
  });

  it('an explicit undefined optional field is dropped, not refused; the restored command reads the same', () => {
    const { sim, w } = queued();
    w.sim.queueCommand({ kind: 'move', ids: [0], x: 1, y: 2, append: undefined });
    const fresh = runSetup(SEED).sim;
    restoreSim(fresh, encodeSim(sim));
    const q = props(fresh).commandQueue as { kind: string; ids: number[]; append?: boolean }[];
    const last = q[q.length - 1];
    expect(last).toEqual({ kind: 'move', ids: [0], x: 1, y: 2 });
    expect(Object.hasOwn(last, 'append')).toBe(false);
  });

  it('a fork cut at a boundary that holds queued commands stays clean (the rally order a runtime queues after its tick)', () => {
    type W = ReturnType<typeof runSetup>;
    const v = forkWitness<W>({
      build: () => runSetup(RUN_SEED),
      drive: (w, t) => runDrive(w.sim, t, w.ids),
      // Queued AFTER the tick, as MissionRuntime.step queues a rally order: the boundary at T = 100 holds them.
      advance: (w) => {
        w.sim.tick();
        if (w.sim.tickCount % 50 === 0) {
          w.sim.queueCommand({ kind: 'attackMove', ids: [w.ids.west[0]], x: fx.fromInt(30), y: fx.fromInt(30), sweep: true });
          w.sim.queueCommand({ kind: 'setRally', side: 0, line: 0, x: fx.fromInt(5), y: fx.fromInt(5) });
        }
      },
      T: 100,
      horizon: 200,
      hashEvery: 20,
      poison: true,
      afterRestore: (b, a) => {
        expect((props(a.sim).commandQueue as unknown[]).length, 'A holds a queued command at the cut').toBeGreaterThan(0);
        expect(props(b.sim).commandQueue).toEqual(props(a.sim).commandQueue);
        expect(props(b.sim).runtimeQueue).toEqual(props(a.sim).runtimeQueue);
      },
    });
    expect(v.configDifference).toBeNull();
    expect(v.roundTripEqualAtT, 'round trip at T').toBe(true);
    expect(v.hashDivergedAt).toBeNull();
    expect(v.encodingEqualAtEnd, v.firstDifference).toBe(true);
  });

  it('the golden economy replay can be encoded, restored and re-encoded at ticks 700 and 1100, which hold a queued rally order', () => {
    const ew = economySetup(ECONOMY_SEED);
    const seen: number[] = [];
    for (let t = 0; t <= 1100; t++) {
      if (t === 700 || t === 1100) {
        expect((props(ew.sim).commandQueue as unknown[]).length, `tick ${t} holds a queued command`).toBeGreaterThan(0);
        const S = encodeSim(ew.sim);
        const fresh = economySetup(ECONOMY_SEED).sim;
        restoreSim(fresh, S);
        expect(bytesEqual(encodeSim(fresh), S), `tick ${t}: re-encode`).toBe(true);
        expect(props(fresh).commandQueue).toEqual(props(ew.sim).commandQueue);
        seen.push(t);
      }
      if (t < 1100) {
        economyDrive(ew, t);
        economyAdvance(ew, ew.sim.tickCount);
      }
    }
    expect(seen).toEqual([700, 1100]);
  });

  it('the decoder refuses a queue it cannot trust, with a SnapshotRefused naming the queue', () => {
    const { sim } = queued();
    const good = encodeSim(sim);
    const refused = (edit: (tail: Record<string, unknown>) => void, reason: RegExp): void => {
      const bytes = withTail(good, edit);
      expect(refusal(() => restoreSim(runSetup(SEED).sim, bytes)).reason).toMatch(reason);
    };
    const cq = (tail: Record<string, unknown>): Record<string, unknown>[] => tail.commandQueue as Record<string, unknown>[];
    const rq = (tail: Record<string, unknown>): Record<string, unknown>[] => tail.runtimeQueue as Record<string, unknown>[];
    refused((t) => { t.commandQueue = {}; }, /commandQueue: not an array/);
    refused((t) => { t.commandQueue = Array.from({ length: 65 }, () => ({ kind: 'halt', ids: [0] })); }, /commandQueue: 65 commands/);
    refused((t) => { t.runtimeQueue = Array.from({ length: 65 }, () => ({ kind: 'clearRally', side: 0, line: 0 })); }, /runtimeQueue: 65 commands/);
    refused((t) => { cq(t)[0] = { kind: 'explode', ids: [0] }; }, /commandQueue: bad entry/);
    refused((t) => { cq(t)[0] = { kind: 'build', side: 0, unit: 'x' }; }, /build does not belong in this queue/);
    refused((t) => { rq(t)[0] = { kind: 'halt', ids: [0] }; }, /halt does not belong in this queue/);
    refused((t) => { cq(t)[0] = { kind: 'halt', ids: ['a'] }; }, /halt: bad ids/);
    refused((t) => { cq(t)[0] = { kind: 'halt', ids: [128] }; }, /halt: bad ids/);
    refused((t) => { cq(t)[0] = { kind: 'halt', ids: [-1] }; }, /halt: bad ids/);
    refused((t) => { cq(t)[0] = { kind: 'halt', ids: [0], extra: 1 }; }, /halt: unknown field extra/);
    refused((t) => { cq(t)[0] = { kind: 'halt' }; }, /halt: missing ids/);
    refused((t) => { cq(t)[0] = { kind: 'move', ids: [0], x: '1', y: 2 }; }, /move: bad x/);
    refused((t) => { cq(t)[0] = { kind: 'move', ids: [0], x: 2 ** 31, y: 2 }; }, /move: bad x/);
    refused((t) => { cq(t)[0] = { kind: 'move', ids: [0], x: 1, y: 2, append: 1 }; }, /move: bad append/);
    refused((t) => { cq(t)[0] = { kind: 'setStance', ids: [0], stance: 'sleep' }; }, /setStance: bad stance/);
    refused((t) => { cq(t)[0] = { kind: 'setStance', ids: [0], stance: 'patrol', waypoints: [[1, 2, 3]] }; }, /setStance: bad waypoints/);
    refused((t) => { rq(t)[0] = { kind: 'support', side: 0, support: 'nuke', x: 1, y: 2 }; }, /support: bad support/);
    refused((t) => { rq(t)[0] = { kind: 'build', side: 0, unit: 'x'.repeat(65) }; }, /build: bad unit/);
  });

  it('the encoder refuses (a plain Error) a queue the decoder would refuse, rather than writing an unrestorable snapshot', () => {
    const sim = runSetup(SEED).sim;
    (props(sim).commandQueue as unknown[]).push({ kind: 'halt', ids: [0.5] });
    expect(() => encodeSim(sim)).toThrow(/encodeSim: commandQueue: halt: bad ids/);
    const sim2 = runSetup(SEED).sim;
    (props(sim2).runtimeQueue as unknown[]).push({ kind: 'halt', ids: [0] });
    expect(() => encodeSim(sim2)).toThrow(/encodeSim: runtimeQueue: halt does not belong/);
    const sim3 = runSetup(SEED).sim;
    for (let i = 0; i < 65; i++) sim3.queueCommand({ kind: 'halt', ids: [0] });
    expect(() => encodeSim(sim3)).toThrow(/65 commands/);
  });
});

describe('snapshot: restoreSim refuses a different world, before writing anything', () => {
  const base = (() => {
    const a = runSetup(SEED);
    advance(a, 0, 50);
    return encodeSim(a.sim);
  })();

  /** Asserts the refusal and that the target is byte-for-byte what it was. */
  const refusedUntouched = (target: Sim, bytes: Uint8Array, reason: RegExp): void => {
    const before = encodeSim(target);
    expect(refusal(() => restoreSim(target, bytes)).reason).toMatch(reason);
    expect(bytesEqual(encodeSim(target), before), 'a header refusal writes nothing').toBe(true);
  };

  it('a different capacity', () => {
    refusedUntouched(new Sim({ seed: SEED, width: 48, height: 48, capacity: 64 }), base, /capacity/);
  });
  it('a different width', () => {
    refusedUntouched(new Sim({ seed: SEED, width: 40, height: 48, capacity: 128 }), base, /width/);
  });
  it('a different height', () => {
    refusedUntouched(new Sim({ seed: SEED, width: 48, height: 40, capacity: 128 }), base, /height/);
  });
  it('a different format', () => {
    const b = base.slice();
    b[4] = SNAPSHOT_FORMAT + 1;
    refusedUntouched(runSetup(SEED).sim, b, /format/);
  });
  it('a different schema digest', () => {
    const b = base.slice();
    b[6] ^= 1; // the digest follows the 4-byte magic and the u16 format
    refusedUntouched(runSetup(SEED).sim, b, /schema digest/);
  });
  it('a header tick that disagrees with the stream is refused with the target untouched', () => {
    const b = base.slice();
    b[22] ^= 1; // simTick follows magic 4, format 2, digest 4, build 2, content 4, matchId 2, frameTick 4
    refusedUntouched(runSetup(SEED).sim, b, /tickCount/);
  });
  it('a bad magic', () => {
    const b = base.slice();
    b[0] = 0;
    refusedUntouched(runSetup(SEED).sim, b, /magic/);
  });
  it('a target set up without the boulders the source had', () => {
    const a = boulderSetup(SEED);
    advance(a, 0, 20);
    refusedUntouched(runSetup(SEED).sim, encodeSim(a.sim), /boulders/);
  });
  it('the digest really is a function of every row: a changed class, kind or order changes it', () => {
    const d0 = snapshotSchemaDigest();
    const flipped = SIM_SNAPSHOT_SCHEMA.map((r, i) => (i === 3 ? { ...r, cls: 'config' as const } : r));
    expect(snapshotSchemaDigest(flipped)).not.toBe(d0);
    const rekinded = SIM_SNAPSHOT_SCHEMA.map((r) => (r.name === 'posX' ? { ...r, kind: { t: 'scalar' as const } } : r));
    expect(snapshotSchemaDigest(rekinded)).not.toBe(d0);
    const swapped = [...SIM_SNAPSHOT_SCHEMA];
    [swapped[17], swapped[18]] = [swapped[18], swapped[17]];
    expect(snapshotSchemaDigest(swapped)).not.toBe(d0);
    expect(snapshotSchemaDigest(SIM_SNAPSHOT_SCHEMA)).toBe(d0);
  });
});

describe('snapshot: other refusals', () => {
  it('a column whose length differs from the target is refused, not clamped', () => {
    const a = runSetup(SEED);
    advance(a, 0, 20);
    const b = encodeSim(a.sim);
    // The first u32 equal to width*height is `blocked`'s length word: the header holds no such number.
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let found = -1;
    for (let p = 0; p + 4 <= b.length; p++) {
      if (view.getUint32(p, true) === 48 * 48) {
        found = p;
        break;
      }
    }
    expect(found).toBeGreaterThan(0);
    view.setUint32(found, 48 * 48 + 1, true);
    expect(refusal(() => restoreSim(runSetup(SEED).sim, b)).reason).toMatch(/length/);
  });

  it('two columns that are one array in the target must agree in the stream', () => {
    const a = runSetup(SEED);
    advance(a, 0, 20);
    const b = encodeSim(a.sim);
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const cells = 48 * 48;
    const words: number[] = [];
    for (let p = 0; p + 4 <= b.length && words.length < 3; p++) if (view.getUint32(p, true) === cells) words.push(p);
    // blocked, boulder is config (not written), blockedVehicleMask, cover: the second is the alias.
    const mask = words[1];
    b[mask + 4 + 100] ^= 1;
    expect(refusal(() => restoreSim(runSetup(SEED).sim, b)).reason).toMatch(/same array as blocked/);
  });

  it('meta strings are length-bounded on both sides', () => {
    const sim = runSetup(SEED).sim;
    expect(() => encodeSim(sim, { build: 'x'.repeat(257) })).toThrow(/limit/);
    expect(() => encodeSim(sim, { contentDigest: 2 ** 32 })).toThrow(/u32/);
    expect(() => encodeSim(sim, { frameTick: -1 })).toThrow(/u32/);
    expect(() => encodeSim(sim, { matchId: 'a\ud800b' })).toThrow(/surrogate/);
    expect(() => encodeSim(sim, { build: '\udc00' })).toThrow(/surrogate/);
    expect(() => encodeSim(sim, { matchId: 'ok \ud83d\ude00' })).not.toThrow();
    const ok = encodeSim(sim, { build: 'x'.repeat(256) });
    const b = ok.slice();
    // the build length u16 is the first thing after the fixed header; make it 257 (and the stream no longer lines up)
    b[SNAPSHOT_FIXED_HEADER_BYTES] = 1;
    b[SNAPSHOT_FIXED_HEADER_BYTES + 1] = 1;
    expect(refusal(() => restoreSim(runSetup(SEED).sim, b)).reason).toMatch(/build/);
    // and the matchId length follows the build text
    const m = encodeSim(sim, { build: 'ab', matchId: 'cd' });
    const at = SNAPSHOT_FIXED_HEADER_BYTES + 2 + 2;
    expect(m[at]).toBe(2);
    m[at] = 1;
    m[at + 1] = 1;
    expect(refusal(() => restoreSim(runSetup(SEED).sim, m)).reason).toMatch(/matchId/);
  });

  it('a count past its capacity is refused', () => {
    const a = runSetup(SEED);
    advance(a, 0, 10);
    props(a.sim).count = 129; // capacity is 128
    expect(refusal(() => restoreSim(runSetup(SEED).sim, encodeSim(a.sim))).reason).toMatch(/count 129/);
  });

  it('a live unit whose type is not registered is refused', () => {
    const a = runSetup(SEED);
    advance(a, 0, 10);
    (props(a.sim).typeIdx as Uint16Array)[0] = 99;
    expect(refusal(() => restoreSim(runSetup(SEED).sim, encodeSim(a.sim))).reason).toMatch(/type 99/);
  });

  it('a live structure whose type is not registered is refused', () => {
    const a = runSetup(SEED);
    advance(a, 0, 10);
    (props(a.sim).stTypeIdx as Uint16Array)[0] = 99;
    expect(refusal(() => restoreSim(runSetup(SEED).sim, encodeSim(a.sim))).reason).toMatch(/structure 0/);
  });

  it('trailing bytes and a short tail are refused', () => {
    const a = runSetup(SEED);
    advance(a, 0, 10);
    const b = encodeSim(a.sim);
    const longer = new Uint8Array(b.length + 1);
    longer.set(b);
    expect(refusal(() => restoreSim(runSetup(SEED).sim, longer)).reason).toMatch(/trailing/);
    expect(refusal(() => restoreSim(runSetup(SEED).sim, b.subarray(0, b.length - 1))).reason).toMatch(/truncated/);
  });

  it('a tail that parses but is not canonical (whitespace) is refused', () => {
    const a = runSetup(SEED);
    advance(a, 0, 10);
    const b = encodeSim(a.sim);
    // Find the tail start: the last u32 whose value is the byte count after it, followed by '{'.
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let start = -1;
    for (let p = b.length - 5; p >= 0; p--) {
      if (p + 4 + view.getUint32(p, true) === b.length && b[p + 4] === 0x7b) {
        start = p;
        break;
      }
    }
    expect(start).toBeGreaterThan(0);
    const text = new TextDecoder().decode(b.subarray(start + 4));
    const spaced = new TextEncoder().encode(text.replace('{', '{ '));
    const out = new Uint8Array(start + 4 + spaced.length);
    out.set(b.subarray(0, start));
    new DataView(out.buffer).setUint32(start, spaced.length, true);
    out.set(spaced, start + 4);
    expect(refusal(() => restoreSim(runSetup(SEED).sim, out)).reason).toMatch(/canonical/);
  });
});

describe('snapshot: canonical JSON', () => {
  it('sorts keys at every depth, whatever the insertion order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('writes -0 as 0', () => {
    expect(canonicalJson([-0, 0])).toBe('[0,0]');
  });
  it('carries strings, booleans and null', () => {
    expect(canonicalJson({ s: 'a"b\n', t: true, f: false, n: null })).toBe('{"f":false,"n":null,"s":"a\\"b\\n","t":true}');
  });
  it('refuses NaN, Infinity, fractions, undefined, functions, bigints and non-plain objects', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0.5, undefined, () => 1, 5n, new Map(), new Set(), new Uint8Array(2), new (class K {})(), Symbol('s')]) {
      expect(() => canonicalJson([bad]), String(bad)).toThrow();
    }
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(2 ** 60)).toThrow();
    expect(() => canonicalJson(JSON.parse('{"__proto__":1}'))).toThrow();
  });
  it('refuses nesting past its depth bound', () => {
    let v: unknown = 1;
    for (let i = 0; i < 40; i++) v = [v];
    expect(() => canonicalJson(v)).toThrow(/deep/);
  });
});

describe('snapshot: exports', () => {
  it('index.ts exports the codec', () => {
    expect(simIndex.encodeSim).toBe(encodeSim);
    expect(simIndex.restoreSim).toBe(restoreSim);
    expect(simIndex.SnapshotRefused).toBe(SnapshotRefused);
    expect(simIndex.SNAPSHOT_FORMAT).toBe(1);
  });
  it('index.ts does not export the witness: tools and tests import snapshot-witness.ts by path', () => {
    const names = Object.keys(simIndex);
    for (const gone of ['forkWitness', 'forkWitnessSeries', 'stateRowsMoved', 'configDiff']) {
      expect(names, gone).not.toContain(gone);
    }
  });
});

describe('snapshot: fuzz', () => {
  it('2,000 seeded mutations: each is a clean refusal or a canonical world, and no ArrayBuffer growth past 4 MiB', () => {
    const a = runSetup(SEED);
    advance(a, 0, 137);
    withPending(a.sim);
    const base = encodeSim(a.sim);
    const view0 = new DataView(base.buffer, base.byteOffset, base.byteLength);

    // Where the length words are: every u32 equal to a column length this world has.
    const lengths = new Set<number>();
    for (const row of rowsOf('state')) {
      if (row.kind.t === 'typed') lengths.add((props(a.sim)[row.name] as ArrayLike<number>).length);
    }
    lengths.add(a.sim.capacity);
    const lengthWords: number[] = [];
    for (let p = 0; p + 4 <= base.length; p++) if (lengths.has(view0.getUint32(p, true))) lengthWords.push(p);
    expect(lengthWords.length).toBeGreaterThan(100);
    // The EXACT column length words: from the first (`blocked`, the first u32 equal to width*height),
    // each column is its u32 length word then length * element-size bytes.
    const sizeOf = { Int8Array: 1, Uint8Array: 1, Int16Array: 2, Uint16Array: 2, Int32Array: 4, Uint32Array: 4 };
    const columnWords: number[] = [];
    for (let p = lengthWords.find((q) => view0.getUint32(q, true) === 48 * 48) ?? -1, i = 0, rows = rowsOf('state').filter((r) => r.kind.t === 'typed'); i < rows.length; i++) {
      columnWords.push(p);
      const kind = rows[i].kind;
      p += 4 + view0.getUint32(p, true) * (kind.t === 'typed' ? sizeOf[kind.ctor] : 0);
    }
    expect(columnWords.length).toBeGreaterThan(100);
    expect(view0.getUint32(columnWords[columnWords.length - 1], true)).toBe(
      (props(a.sim).prWeaponIdx as Uint16Array).length // the walk lands exactly on the last state column
    );
    // The tail: the last u32 that is the count of bytes after it, followed by '{'.
    let tailStart = -1;
    for (let p = base.length - 5; p >= 0; p--) {
      if (p + 4 + view0.getUint32(p, true) === base.length && base[p + 4] === 0x7b) {
        tailStart = p;
        break;
      }
    }
    expect(tailStart).toBeGreaterThan(0);

    const rng = new Rng(0xf022, 1);
    const draw = (n: number): number => rng.nextU32(0) % n;
    const kinds = ['truncate', 'bitflip', 'oversized', 'garbage-tail'] as const;
    const tally: Record<string, { refused: number; accepted: number }> = {};
    for (const k of kinds) tally[k] = { refused: 0, accepted: 0 };

    for (let i = 0; i < 2000; i++) {
      const kind = kinds[i % kinds.length];
      let m: Uint8Array;
      let mustBeLength = false;
      if (kind === 'truncate') {
        m = base.slice(0, draw(base.length));
      } else if (kind === 'bitflip') {
        m = base.slice();
        m[draw(m.length)] ^= 1 << draw(8);
      } else if (kind === 'oversized') {
        m = base.slice();
        // Half the time a real column length word, which MUST be refused as a length; else any word that looks like one.
        const exact = draw(2) === 0;
        const p = exact ? columnWords[draw(columnWords.length)] : lengthWords[draw(lengthWords.length)];
        const word = [0xffffffff, 0x7fffffff, 0x10000000, 0x01000000, new DataView(m.buffer).getUint32(p, true) + 1][draw(5)];
        new DataView(m.buffer).setUint32(p, word, true);
        if (exact) mustBeLength = true;
      } else {
        const garbage = new Uint8Array(draw(300));
        for (let g = 0; g < garbage.length; g++) garbage[g] = draw(256);
        if (draw(2) === 0) {
          // A consistent length word over garbage.
          m = new Uint8Array(tailStart + 4 + garbage.length);
          m.set(base.subarray(0, tailStart));
          new DataView(m.buffer).setUint32(tailStart, garbage.length, true);
          m.set(garbage, tailStart + 4);
        } else {
          // The old length word over garbage that does not match it.
          m = new Uint8Array(tailStart + 4 + garbage.length);
          m.set(base.subarray(0, tailStart + 4));
          m.set(garbage, tailStart + 4);
        }
      }

      const target = runSetup(SEED).sim;
      const mem0 = process.memoryUsage().arrayBuffers;
      let meta: ReturnType<typeof restoreSim> | null = null;
      try {
        meta = restoreSim(target, m);
      } catch (e) {
        expect(e, `case ${i} (${kind}) threw something other than SnapshotRefused`).toBeInstanceOf(SnapshotRefused);
        if (mustBeLength) {
          expect((e as SnapshotRefused).reason, `case ${i}: a wrong column length word must be refused as a length`).toMatch(/^column \S+: length \d+, this world has \d+$/);
        }
      }
      const grown = process.memoryUsage().arrayBuffers - mem0;
      expect(grown, `case ${i} (${kind}) allocated ${grown} bytes`).toBeLessThan(4 * 1024 * 1024);
      if (meta === null) {
        tally[kind].refused++;
      } else if (mustBeLength) {
        throw new Error(`case ${i}: a wrong column length word was accepted`);
      } else {
        tally[kind].accepted++;
        // An accepted mutation must be a valid, canonical world: it encodes again, and to the very bytes it came from.
        expect(bytesEqual(encodeSim(target, meta), m), `case ${i} (${kind}) was accepted but is not canonical`).toBe(true);
      }
    }
    const refused = kinds.reduce((n, k) => n + tally[k].refused, 0);
    const accepted = kinds.reduce((n, k) => n + tally[k].accepted, 0);
    expect(refused + accepted).toBe(2000);
    // Not vacuous: the refusals are many, and some mutations land harmlessly in a column and are accepted.
    expect(refused).toBeGreaterThan(1000);
    expect(accepted).toBeGreaterThan(100);
    expect(tally.truncate.accepted).toBe(0);
    expect(tally['garbage-tail'].refused).toBeGreaterThan(400);
  }, 120000);
});

// ---- the flow-field pool (Task 4) ---------------------------------------------

/** A wheeled rifle-armed vehicle (a DOMAIN_VEHICLE walker) and an air unit, beside the golden battle. */
const WHEELED: UnitTypeJson = { ...RIFLES, id: 't_wheeled', mobility: { ...RIFLES.mobility, wheeled: true } };
const AIRCRAFT: UnitTypeJson = { ...RIFLES, id: 't_air', mobility: { ...RIFLES.mobility, domain: 'air' } };

interface PoolWorld {
  sim: Sim;
  ids: ReturnType<typeof runSetup>['ids'];
  wheeled: number;
  air: number;
}

/** The golden battle plus boulders, a wheeled unit and an aircraft, so all three domains hold fields. */
function poolSetup(seed: number): PoolWorld {
  const w = boulderSetup(seed);
  const wheeled = w.sim.spawn(w.sim.addUnitType(WHEELED), 0, fx.fromInt(6), fx.fromInt(30));
  const air = w.sim.spawn(w.sim.addUnitType(AIRCRAFT), 0, fx.fromInt(6), fx.fromInt(34));
  return { ...w, wheeled, air };
}

function poolDrive(w: PoolWorld, t: number): void {
  runDrive(w.sim, t, w.ids);
  if (t === 3) w.sim.queueCommand({ kind: 'move', ids: [w.wheeled], x: fx.fromInt(20), y: fx.fromInt(6) });
  if (t === 4) w.sim.queueCommand({ kind: 'move', ids: [w.air], x: fx.fromInt(40), y: fx.fromInt(40) });
  if (t === 150) w.sim.queueCommand({ kind: 'move', ids: [w.wheeled], x: fx.fromInt(12), y: fx.fromInt(42) });
}

function advancePool(w: PoolWorld, from: number, to: number): void {
  for (let t = from; t < to; t++) {
    poolDrive(w, t);
    w.sim.tick();
  }
}

/** Every keyed slot of `sim`: [domain, goal, slot, dirs, costs]. The unkeyed slots' bytes are unobservable and not listed. */
function keyedFields(sim: Sim): { domain: number; goal: number; slot: number; dirs: number[]; cost: number[] }[] {
  const keys = sim.fieldPoolKeys();
  const fields = props(sim).fields as { dirs: Uint8Array; costAt(t: number): number }[];
  const cells = sim.width * sim.height;
  const out: ReturnType<typeof keyedFields> = [];
  keys.order.forEach((list, domain) => {
    for (const slot of list) {
      const cost: number[] = [];
      for (let t = 0; t < cells; t++) cost.push(fields[slot].costAt(t));
      out.push({ domain, goal: keys.slots[slot].goal, slot, dirs: Array.from(fields[slot].dirs), cost });
    }
  });
  return out;
}

/** The same world's pool state, apart from the field bytes: what `fieldFor` and `evictableField` read. */
function poolBookkeeping(sim: Sim): unknown {
  const s = props(sim);
  return {
    fieldRef: Array.from(s.fieldRef as Int32Array),
    goalKey: [...(s.fieldGoalKey as number[])],
    domain: [...(s.fieldDomain as number[])],
    lastIssued: [...(s.fieldLastIssued as number[])],
    maps: (s.fieldByGoal as Map<number, number>[]).map((m) => [...m]),
    watermark: (s.fields as unknown[]).length,
  };
}

/** Rewrites the canonical JSON tail of `bytes` through `edit`, re-canonicalised, with the length word fixed. */
function withTail(bytes: Uint8Array, edit: (tail: Record<string, unknown>) => void): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let start = -1;
  for (let p = bytes.length - 5; p >= 0; p--) {
    if (p + 4 + view.getUint32(p, true) === bytes.length && bytes[p + 4] === 0x7b) {
      start = p;
      break;
    }
  }
  expect(start).toBeGreaterThan(0);
  const tail = JSON.parse(new TextDecoder().decode(bytes.subarray(start + 4))) as Record<string, unknown>;
  edit(tail);
  const tb = new TextEncoder().encode(canonicalJson(tail));
  const out = new Uint8Array(start + 4 + tb.length);
  out.set(bytes.subarray(0, start));
  new DataView(out.buffer).setUint32(start, tb.length, true);
  out.set(tb, start + 4);
  return out;
}

describe('snapshot: the flow-field pool is rebuilt from its keys', () => {
  it('1000-tick world, restore at 100, 250, 320 and 700: every keyed slot equals the source byte for byte', () => {
    const a = runSetup(SEED);
    let at = 0;
    const blockedAt: string[] = [];
    for (const T of [100, 250, 320, 700]) {
      advance(a, at, T);
      at = T;
      blockedAt.push(Array.from(props(a.sim).blocked as Uint8Array).join(''));
      const S = encodeSim(a.sim);
      const fresh = runSetup(SEED).sim;
      restoreSim(fresh, S);
      const want = keyedFields(a.sim);
      expect(want.length, `tick ${T}: the source keys some fields`).toBeGreaterThan(5);
      expect(keyedFields(fresh), `tick ${T}: dirs and costs`).toEqual(want);
      expect(poolBookkeeping(fresh), `tick ${T}: the bookkeeping`).toEqual(poolBookkeeping(a.sim));
      expect(bytesEqual(encodeSim(fresh), S), `tick ${T}: re-encode`).toBe(true);
    }
    // The shed falls at about tick 116, so the masks differ between 100 and 250: the rebuild reads the RESTORED ones.
    expect(blockedAt[0]).not.toBe(blockedAt[1]);
    expect(blockedAt[1]).toBe(blockedAt[3]);
  });

  it('the source pool has an unkeyed slot, and it is carried with its lastIssued', () => {
    const a = runSetup(SEED);
    advance(a, 0, 250);
    const keys = a.sim.fieldPoolKeys();
    const unkeyed = keys.slots.filter((s) => s.goal === -1);
    expect(unkeyed.length).toBeGreaterThan(0);
    const fresh = runSetup(SEED).sim;
    restoreSim(fresh, encodeSim(a.sim));
    expect(fresh.fieldPoolKeys()).toEqual(keys);
  });

  it('a world with boulders, a wheeled unit and an aircraft: all three domains round trip', () => {
    const a = poolSetup(SEED);
    advancePool(a, 0, 400);
    const keys = a.sim.fieldPoolKeys();
    expect(keys.order.map((o) => o.length).every((n) => n > 0), `a field in every domain: ${keys.order.map((o) => o.length).join(',')}`).toBe(true);
    const S = encodeSim(a.sim);
    const fresh = poolSetup(SEED).sim;
    restoreSim(fresh, S);
    expect(keyedFields(fresh)).toEqual(keyedFields(a.sim));
    expect(poolBookkeeping(fresh)).toEqual(poolBookkeeping(a.sim));
    expect(bytesEqual(encodeSim(fresh), S)).toBe(true);
    // A vehicle field really differs from the foot field toward the same goal (the boulders), so the mask choice is witnessed.
    const vehicle = keyedFields(a.sim).filter((f) => f.domain === 1);
    const foot = keyedFields(a.sim).filter((f) => f.domain === 0);
    const air = keyedFields(a.sim).filter((f) => f.domain === 2);
    expect(vehicle.length).toBeGreaterThan(0);
    expect(air.length).toBeGreaterThan(0);
    // The air field is blind to walls: it must differ from every ground field's dirs.
    for (const f of air) expect(foot.some((g) => g.goal === f.goal && g.dirs.join() === f.dirs.join())).toBe(false);
  });

  it('a target whose pool is already non-empty is replaced, larger or smaller', () => {
    const wm = (s: Sim): number => (props(s).fields as unknown[]).length;
    const source = poolSetup(SEED);
    advancePool(source, 0, 100);
    const small = encodeSim(source.sim);
    advancePool(source, 100, 700);
    const large = encodeSim(source.sim);
    const atHundred = poolSetup(SEED);
    advancePool(atHundred, 0, 100);

    // Grow: a target that has only issued a few orders takes the larger pool.
    const grow = poolSetup(SEED);
    advancePool(grow, 0, 8);
    expect(wm(grow.sim)).toBeGreaterThan(0);
    expect(wm(grow.sim)).toBeLessThan(wm(source.sim));
    restoreSim(grow.sim, large);
    expect(wm(grow.sim)).toBe(wm(source.sim));
    expect(poolBookkeeping(grow.sim)).toEqual(poolBookkeeping(source.sim));
    expect(keyedFields(grow.sim)).toEqual(keyedFields(source.sim));
    expect(bytesEqual(encodeSim(grow.sim), large)).toBe(true);

    // Truncate: a target that has run on to tick 700 takes the pool of tick 100.
    const shrink = poolSetup(SEED);
    advancePool(shrink, 0, 700);
    expect(wm(shrink.sim)).toBeGreaterThan(wm(atHundred.sim));
    restoreSim(shrink.sim, small);
    expect(wm(shrink.sim)).toBe(wm(atHundred.sim));
    expect(poolBookkeeping(shrink.sim)).toEqual(poolBookkeeping(atHundred.sim));
    expect(keyedFields(shrink.sim)).toEqual(keyedFields(atHundred.sim));
    expect(bytesEqual(encodeSim(shrink.sim), small)).toBe(true);
  });

  it('a world with relief: the rebuilt fields read the restored elevation', () => {
    const a = reliefSetup(SEED, true);
    for (let t = 0; t < 400; t++) {
      reliefDrive(a.sim, t, a.up);
      a.sim.tick();
    }
    const want = keyedFields(a.sim);
    expect(want.length).toBeGreaterThan(0);
    expect(Math.max(...(props(a.sim).elevation as Uint8Array)), 'the map has relief').toBeGreaterThan(0);
    const S = encodeSim(a.sim);
    const fresh = reliefSetup(SEED, true).sim;
    restoreSim(fresh, S);
    expect(keyedFields(fresh)).toEqual(want);
    expect(bytesEqual(encodeSim(fresh), S)).toBe(true);
  });

  it('restore-then-step: a restored world keeps choosing the same slots as the uninterrupted run', () => {
    const a = poolSetup(SEED);
    advancePool(a, 0, 300);
    const fresh = poolSetup(SEED);
    restoreSim(fresh.sim, encodeSim(a.sim));
    for (let t = 300; t < 460; t++) {
      poolDrive(a, t);
      a.sim.tick();
      poolDrive(fresh, t);
      fresh.sim.tick();
      if (t % 20 === 0) expect(poolBookkeeping(fresh.sim), `tick ${t}`).toEqual(poolBookkeeping(a.sim));
    }
    expect(bytesEqual(encodeSim(fresh.sim), encodeSim(a.sim))).toBe(true);
  });

  it('several group orders in one tick grow the pool past capacity + MAX_FLOW_FIELDS, and it still round trips', () => {
    const build = (): { sim: Sim; ids: number[] } => {
      const sim = new Sim({ seed: 7, width: 48, height: 48, capacity: 128 });
      const type = sim.addUnitType(RIFLES);
      const ids: number[] = [];
      for (let i = 0; i < 60; i++) ids.push(sim.spawn(type, 0, fx.fromInt(2 + (i % 10)), fx.fromInt(2 + Math.floor(i / 10))));
      return { sim, ids };
    };
    const a = build();
    // Five orders to the same 60 units inside one frame: each abandons the fields the last issued, and none of them is reusable this tick.
    for (const [x, y] of [[30, 30], [40, 10], [10, 40], [35, 35], [20, 44]]) a.sim.queueCommand({ kind: 'move', ids: a.ids, x: fx.fromInt(x), y: fx.fromInt(y) });
    a.sim.tick();
    expect(a.sim.flowFieldCount, 'the watermark is past the old capacity + MAX_FLOW_FIELDS bound').toBeGreaterThan(a.sim.capacity + MAX_FLOW_FIELDS);
    const S = encodeSim(a.sim);
    const fresh = build().sim;
    restoreSim(fresh, S);
    expect(fresh.flowFieldCount).toBe(a.sim.flowFieldCount);
    expect(poolBookkeeping(fresh)).toEqual(poolBookkeeping(a.sim));
    expect(keyedFields(fresh)).toEqual(keyedFields(a.sim));
    expect(bytesEqual(encodeSim(fresh), S)).toBe(true);
  });

  describe('a pool the decoder will not accept', () => {
    // Built on first use (not in the describe body, which runs at collection time).
    let memo: Uint8Array | null = null;
    const goodBytes = (): Uint8Array => {
      if (memo === null) {
        const a = poolSetup(SEED);
        advancePool(a, 0, 250);
        memo = encodeSim(a.sim);
      }
      return memo;
    };
    const bad = (label: string, edit: (pool: { watermark: number; slots: { goal: number; domain: number; lastIssued: number }[]; order: number[][] }) => void, reason: RegExp): void => {
      it(label, () => {
        const bytes = withTail(goodBytes(), (tail) => edit(tail.fieldPool as Parameters<typeof edit>[0]));
        expect(refusal(() => restoreSim(poolSetup(SEED).sim, bytes)).reason).toMatch(reason);
      });
    };
    it('the unedited bytes restore (the harness for the cases below is sound)', () => {
      expect(() => restoreSim(poolSetup(SEED).sim, withTail(goodBytes(), () => undefined))).not.toThrow();
    });
    // The slot list is padded to match, so the memory bound itself is what refuses: 5,825 fits a 48x48 map, 5,826 does not.
    const justOver = Math.floor(POOL_RESTORE_BUDGET_BYTES / (48 * 48 * 5)) + 1;
    bad('a watermark just past the restore memory budget', (p) => {
      p.watermark = justOver;
      while (p.slots.length < justOver) p.slots.push({ goal: -1, domain: 0, lastIssued: 0 });
    }, /restore budget/);
    it('a watermark exactly at the budget is accepted', () => {
      const bytes = withTail(goodBytes(), (tail) => {
        const p = tail.fieldPool as { watermark: number; slots: unknown[] };
        p.watermark = justOver - 1;
        while (p.slots.length < justOver - 1) p.slots.push({ goal: -1, domain: 0, lastIssued: 0 });
      });
      expect(() => restoreSim(poolSetup(SEED).sim, bytes)).not.toThrow();
    });
    bad('a negative watermark', (p) => { p.watermark = -1; }, /watermark/);
    bad('slots that do not match the watermark', (p) => { p.watermark += 1; }, /watermark/);
    bad('a goal off the map', (p) => { p.slots[p.order[0][0]].goal = 48 * 48; }, /off the map/);
    bad('a domain past DOMAIN_COUNT', (p) => { p.slots[0].domain = 3; }, /domain/);
    bad('a negative lastIssued', (p) => { p.slots[0].lastIssued = -2; }, /lastIssued/);
    bad('a lastIssued in the future', (p) => { p.slots[0].lastIssued = 251; }, /lastIssued/);
    bad('an order list naming a slot twice', (p) => { p.order[0].push(p.order[0][0]); }, /listed twice/);
    bad('an order list naming a slot outside the pool', (p) => { p.order[0].push(p.watermark); }, /names slot/);
    bad('a keyed slot missing from the order lists', (p) => { p.order[0].pop(); }, /missing/);
    bad('a slot listed under the wrong domain', (p) => { p.order[2].push(p.order[0].pop() as number); }, /not keyed there/);
    bad('an unkeyed slot in an order list', (p) => { p.order[0].push(p.slots.findIndex((s) => s.goal === -1)); }, /not keyed there/);
    bad('two slots for one goal', (p) => { p.slots[p.order[0][1]].goal = p.slots[p.order[0][0]].goal; }, /two slots/);
    bad('a pool of the wrong shape', (p) => { (p as unknown as Record<string, unknown>).extra = 1; }, /fieldPool: bad shape/);
    it('a vehicle field on a map with no boulders', () => {
      const w = runSetup(SEED);
      advance(w, 0, 250);
      const bytes = withTail(encodeSim(w.sim), (tail) => {
        const p = tail.fieldPool as { slots: { domain: number }[]; order: number[][] };
        const slot = p.order[0].pop() as number;
        p.slots[slot].domain = 1;
        p.order[1].push(slot);
      });
      expect(refusal(() => restoreSim(runSetup(SEED).sim, bytes)).reason).toMatch(/no boulders/);
    });
    it('a unit following a slot outside the pool', () => {
      const w = runSetup(SEED);
      advance(w, 0, 250);
      const s = encodeSim(w.sim);
      const bytes = withTail(s, (tail) => {
        const p = tail.fieldPool as { watermark: number; slots: unknown[] };
        p.watermark = 1;
        p.slots.length = 1;
        (tail.fieldPool as { order: number[][] }).order = [[], [], []];
        (p.slots[0] as { goal: number }).goal = -1;
      });
      expect(refusal(() => restoreSim(runSetup(SEED).sim, bytes)).reason).toMatch(/outside the pool/);
    });
  });
});
