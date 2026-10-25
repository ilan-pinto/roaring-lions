import { describe, expect, it } from 'vitest';
import {
  ECONOMY_SEED,
  ECONOMY_TICKS,
  RELIEF_ECO_B_ORDER_TICK,
  RELIEF_ECO_SEED,
  RELIEF_ECO_TICKS,
  economyAdvance,
  economyDrive,
  economySetup,
  reliefEconomySetup,
} from './golden-worlds.test-helper';
import { fx } from './fixed';
import { MissionRuntime } from './mission';
import { Rng } from './rng';
import { MAX_RUNTIME_BYTES, encodeRuntimeSection, runtimeSchemaDigest } from './runtime-snapshot';
import { SINK_EVENTS, sinkWorld, walkSink } from './runtime-sink-world.test-helper';
import { censusAt, checkRuntime, newCensus, probeClosures, props } from './runtime-snapshot-schema.test-helper';
import { Sim } from './sim';
import { SNAPSHOT_FIXED_HEADER_BYTES, SNAPSHOT_MATCH_DIGEST_OFFSET, SnapshotRefused, canonicalJson, encodeSim, restoreSim } from './snapshot';

// The runtime half of the snapshot codec (net sim snapshot S2, Task 3): `encodeSim(sim, meta, runtime)` and
// `restoreSim(sim, bytes, runtime)`. The worlds are the two economy replays and the sink world, each restored
// onto a freshly built twin of itself.

interface World {
  readonly sim: Sim;
  readonly rt: MissionRuntime;
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

function refusal(fn: () => unknown): SnapshotRefused {
  try {
    fn();
  } catch (e) {
    expect(e, 'a refusal, not any other error').toBeInstanceOf(SnapshotRefused);
    return e as SnapshotRefused;
  }
  throw new Error('expected SnapshotRefused, nothing was thrown');
}

/** The runtime section's frame in a snapshot's bytes: the u32 length word and the JSON after it. It is the LAST thing in the file. */
function frameOf(bytes: Uint8Array): { start: number; len: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let p = bytes.length - 5; p >= 0; p--) {
    if (p + 4 + v.getUint32(p, true) === bytes.length && bytes[p + 4] === 0x7b) return { start: p, len: v.getUint32(p, true) };
  }
  throw new Error('no runtime section frame found');
}
const sectionOf = (bytes: Uint8Array): Record<string, unknown> => {
  const { start, len } = frameOf(bytes);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(start + 4, start + 4 + len))) as Record<string, unknown>;
};
/** The same snapshot with its runtime section replaced by `text` (the length word follows). */
function withSectionText(bytes: Uint8Array, text: string): Uint8Array {
  const { start } = frameOf(bytes);
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(start + 4 + body.length);
  out.set(bytes.subarray(0, start));
  new DataView(out.buffer).setUint32(start, body.length, true);
  out.set(body, start + 4);
  return out;
}
/** The same snapshot with its runtime section edited (as a parsed object) and re-written canonically. */
function withSection(bytes: Uint8Array, edit: (s: Record<string, unknown>) => void): Uint8Array {
  const s = sectionOf(bytes);
  edit(s);
  return withSectionText(bytes, canonicalJson(s));
}

/** Restore `bytes` onto a fresh world and return the world, the meta and the re-encoding. */
function restoreOnto(fresh: () => World, bytes: Uint8Array): { world: World; again: Uint8Array } {
  const world = fresh();
  const meta = restoreSim(world.sim, bytes, world.rt);
  return { world, again: encodeSim(world.sim, meta, world.rt) };
}

const economyFresh = (): World => economySetup(ECONOMY_SEED);
const reliefFresh = (): World => reliefEconomySetup(RELIEF_ECO_SEED);

/** The census and the kind check on a restored runtime: no unruled alias, the closure holds the right Map, every value fits its row. */
function expectWellFormed(label: string, w: World): void {
  const acc = newCensus();
  censusAt(label, w.rt, w.sim, acc, true);
  expect(acc.failures, `${label}: the restored runtime`).toEqual([]);
  expect(checkRuntime(label, w.rt, w.sim, new Set()), `${label}: kinds`).toEqual([]);
}

const META = { build: 'b-test', matchId: 'room-7', contentDigest: 0xabcdef, frameTick: 123, matchDigest: 0x1234_5678 };

// ---- the economy replays -------------------------------------------------------------------------------

describe('runtime snapshot: encode(restore(fresh, S)) == S over the golden economy replay', () => {
  it('at every 100 ticks and the ticks the replay acts at, including a pending production spawn with a queued rally order', () => {
    const w = economySetup(ECONOMY_SEED);
    const ticks = new Set<number>([1, 405, 700, 805, 1100, 1505, 1520, 1760, 2305]);
    for (let t = 0; t <= ECONOMY_TICKS; t += 100) ticks.add(t);
    let spawnWithRally = 0;
    let checked = 0;
    for (let t = 0; t <= ECONOMY_TICKS; t++) {
      if (ticks.has(t)) {
        const S = encodeSim(w.sim, META, w.rt);
        const { world, again } = restoreOnto(economyFresh, S);
        expect(bytesEqual(again, S), `tick ${t}: re-encode`).toBe(true);
        expect(world.rt.digest(), `tick ${t}: digest`).toBe(w.rt.digest());
        expect(world.rt.economyHash(), `tick ${t}: economyHash`).toBe(w.rt.economyHash());
        expectWellFormed(`economy@${t}`, world);
        const sim = props(w.sim);
        if ((sim.pendingEvents as { kind: string }[]).some((e) => e.kind === 'spawn') && (sim.commandQueue as { kind: string }[]).some((c) => c.kind === 'attackMove')) spawnWithRally++;
        checked++;
      }
      if (t === ECONOMY_TICKS) break;
      economyDrive(w, t);
      economyAdvance(w, t);
    }
    expect(checked).toBeGreaterThan(25);
    // Not vacuous: ticks 700 and 1100 (a delivery) hold a spawn event AND a queued rally order at the frame boundary.
    expect(spawnWithRally, 'the delivery ticks were checked').toBe(2);
  }, 60_000);

  it('restore then step is byte-identical to the uninterrupted run, sim and runtime alike', () => {
    for (const T of [350, 700, 1100, 1480]) {
      const a = economySetup(ECONOMY_SEED);
      for (let t = 0; t < T; t++) {
        economyDrive(a, t);
        economyAdvance(a, t);
      }
      const S = encodeSim(a.sim, META, a.rt);
      const b = economySetup(ECONOMY_SEED);
      restoreSim(b.sim, S, b.rt);
      b.prevProgress = a.prevProgress; // the driver's own observer state, not the world's
      for (let t = T; t < T + 400; t++) {
        economyDrive(a, t);
        economyAdvance(a, t);
        economyDrive(b, t);
        economyAdvance(b, t);
        if (t % 10 === 0) {
          expect(b.sim.hash(), `T=${T} tick ${t}: sim.hash`).toBe(a.sim.hash());
          expect(b.rt.digest(), `T=${T} tick ${t}: digest`).toBe(a.rt.digest());
          expect(b.rt.economyHash(), `T=${T} tick ${t}: economyHash`).toBe(a.rt.economyHash());
        }
      }
      expect(bytesEqual(encodeSim(b.sim, META, b.rt), encodeSim(a.sim, META, a.rt)), `T=${T}: the end states encode alike`).toBe(true);
    }
  }, 60_000);
});

describe('runtime snapshot: encode(restore(fresh, S)) == S over the relief economy replay', () => {
  it('every 100 ticks, with the relief-priced fields rebuilt', () => {
    const { sim, rt } = reliefEconomySetup(RELIEF_ECO_SEED);
    let checked = 0;
    for (let t = 0; t <= RELIEF_ECO_TICKS; t++) {
      if (t % 100 === 0 || t === 1 || t === 105 || t === 1705) {
        const S = encodeSim(sim, META, rt);
        const { world, again } = restoreOnto(reliefFresh, S);
        expect(bytesEqual(again, S), `tick ${t}: re-encode`).toBe(true);
        expect(world.rt.digest(), `tick ${t}: digest`).toBe(rt.digest());
        expectWellFormed(`relief@${t}`, world);
        checked++;
      }
      if (t === RELIEF_ECO_TICKS) break;
      if (t === 5) sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(24.5), y: fx.from(25.5) });
      if (t === 100) rt.requestBuild('inf_squad');
      if (t === RELIEF_ECO_B_ORDER_TICK) sim.queueCommand({ kind: 'move', ids: [1], x: fx.from(24.5), y: fx.from(15.5) });
      rt.step(sim.tick());
    }
    expect(checked).toBeGreaterThan(20);
  }, 60_000);
});

describe('runtime snapshot: the sink world (every container the replays leave empty)', () => {
  it('round-trips at every checkpoint of the walk: tags, patrols, civilians, works, roster, queues, lines', () => {
    let n = 0;
    walkSink((c) => {
      const S = encodeSim(c.sim, META, c.rt);
      const { world, again } = restoreOnto(sinkWorld, S);
      expect(bytesEqual(again, S), `${c.label}: re-encode`).toBe(true);
      expect(world.rt.digest(), `${c.label}: digest`).toBe(c.rt.digest());
      expectWellFormed(c.label, world);
      n++;
    });
    expect(n).toBeGreaterThan(20);
  }, 60_000);

  it('restore then step is byte-identical to the uninterrupted run (sink world, events fed to the runtime)', () => {
    const drive = (w: World, t: number): void => {
      if (t === 2) w.rt.requestConstruct('sink_outpost', 13, 10);
      if (t === 3) for (let k = 0; k < 3; k++) w.rt.requestBuild('sink_squad', 0);
      const events = w.sim.tick();
      if (t === 10) w.rt.step([...events, ...SINK_EVENTS(w.sim.tickCount)]);
      else w.rt.step(events);
      if (t === 40) w.rt.completeObjective('level');
    };
    for (const T of [4, 60, 150]) {
      const a = sinkWorld();
      for (let t = 1; t <= T; t++) drive(a, t);
      const S = encodeSim(a.sim, META, a.rt);
      const b = sinkWorld();
      restoreSim(b.sim, S, b.rt);
      for (let t = T + 1; t <= T + 250; t++) {
        drive(a, t);
        drive(b, t);
        if (t % 10 === 0) {
          expect(b.sim.hash(), `T=${T} tick ${t}: sim.hash`).toBe(a.sim.hash());
          expect(b.rt.digest(), `T=${T} tick ${t}: digest`).toBe(a.rt.digest());
        }
      }
      expect(bytesEqual(encodeSim(b.sim, META, b.rt), encodeSim(a.sim, META, a.rt)), `T=${T}: the end states encode alike`).toBe(true);
    }
  }, 60_000);
});

// ---- the header ---------------------------------------------------------------------------------------------

describe('runtime snapshot: the header', () => {
  it('matchDigest stays at offset 10; hasRuntime and the runtime schema digest close the fixed block', () => {
    expect(SNAPSHOT_MATCH_DIGEST_OFFSET).toBe(10);
    expect(SNAPSHOT_FIXED_HEADER_BYTES).toBe(44);
    const w = economySetup(ECONOMY_SEED);
    const withRt = encodeSim(w.sim, META, w.rt);
    const without = encodeSim(w.sim, META);
    const u32At = (b: Uint8Array, p: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(p, true);
    expect(u32At(withRt, SNAPSHOT_MATCH_DIGEST_OFFSET)).toBe(META.matchDigest);
    expect(u32At(without, SNAPSHOT_MATCH_DIGEST_OFFSET)).toBe(META.matchDigest);
    expect(withRt[SNAPSHOT_FIXED_HEADER_BYTES - 5]).toBe(1);
    expect(u32At(withRt, SNAPSHOT_FIXED_HEADER_BYTES - 4)).toBe(runtimeSchemaDigest());
    expect(runtimeSchemaDigest()).not.toBe(0);
    expect(without[SNAPSHOT_FIXED_HEADER_BYTES - 5]).toBe(0);
    expect(u32At(without, SNAPSHOT_FIXED_HEADER_BYTES - 4)).toBe(0);
    // The strings follow the fixed block whatever the runtime is.
    expect(withRt[SNAPSHOT_FIXED_HEADER_BYTES] | (withRt[SNAPSHOT_FIXED_HEADER_BYTES + 1] << 8)).toBe(META.build.length);
  });

  it('a sim-only snapshot is unchanged by the runtime table (digest 0)', () => {
    const w = economySetup(ECONOMY_SEED);
    const a = encodeSim(w.sim, META);
    const target = economySetup(ECONOMY_SEED);
    expect(bytesEqual(encodeSim(target.sim, META), a)).toBe(true);
    // And it restores onto a world with no runtime passed.
    const fresh = economySetup(ECONOMY_SEED);
    restoreSim(fresh.sim, a);
    expect(bytesEqual(encodeSim(fresh.sim, META), a)).toBe(true);
  });
});

// ---- refusals ---------------------------------------------------------------------------------------------------

describe('runtime snapshot: refusals', () => {
  const world = (): { S: Uint8Array; w: World } => {
    const w = economySetup(ECONOMY_SEED);
    for (let t = 0; t < 500; t++) {
      economyDrive(w, t);
      economyAdvance(w, t);
    }
    return { S: encodeSim(w.sim, META, w.rt), w };
  };

  it('a snapshot with a runtime refuses a target without one, and the reverse', () => {
    const { S, w } = world();
    const simOnly = encodeSim(w.sim, META);
    expect(refusal(() => restoreSim(economySetup(ECONOMY_SEED).sim, S)).reason).toBe('the snapshot carries a runtime, this world has none');
    const t = economySetup(ECONOMY_SEED);
    expect(refusal(() => restoreSim(t.sim, simOnly, t.rt)).reason).toBe('the snapshot carries no runtime, this world has one');
  });

  it('refuses a runtime schema digest mismatch before writing anything', () => {
    const { S } = world();
    const bad = S.slice();
    bad[SNAPSHOT_FIXED_HEADER_BYTES - 4] ^= 1;
    const t = economySetup(ECONOMY_SEED);
    const before = encodeSim(t.sim, META, t.rt);
    expect(refusal(() => restoreSim(t.sim, bad, t.rt)).reason).toMatch(/runtime schema digest differs/);
    expect(bytesEqual(encodeSim(t.sim, META, t.rt), before), 'the header refusal left the target untouched').toBe(true);
  });

  it('refuses a digest on a snapshot with no runtime, and a hasRuntime that is not a flag', () => {
    const { w } = world();
    const simOnly = encodeSim(w.sim, META);
    const odd = simOnly.slice();
    odd[SNAPSHOT_FIXED_HEADER_BYTES - 4] = 7;
    expect(refusal(() => restoreSim(economySetup(ECONOMY_SEED).sim, odd)).reason).toMatch(/digest set on a snapshot with no runtime/);
    const flag = simOnly.slice();
    flag[SNAPSHOT_FIXED_HEADER_BYTES - 5] = 2;
    expect(refusal(() => restoreSim(economySetup(ECONOMY_SEED).sim, flag)).reason).toMatch(/not a flag/);
  });

  it('a runtime that is not the sim\'s own is a refusal on restore and a contract Error on encode', () => {
    const { S, w } = world();
    const other = economySetup(ECONOMY_SEED);
    expect(refusal(() => restoreSim(other.sim, S, w.rt)).reason).toBe('the runtime does not belong to this sim');
    expect(() => encodeSim(other.sim, META, w.rt)).toThrow(/does not belong/);
  });

  it('an oversized runtime length word is refused as a limit, not as truncation', () => {
    const { S } = world();
    const { start } = frameOf(S);
    for (const word of [MAX_RUNTIME_BYTES + 1, 0x7fffffff, 0xffffffff]) {
      const m = S.slice();
      new DataView(m.buffer).setUint32(start, word, true);
      expect(refusal(() => restoreOnto(economyFresh, m)).reason, `word ${word}`).toMatch(/^runtime \d+ bytes, the limit is \d+$/);
    }
  });

  it('refuses a truncated section, bytes after it, a section that is not canonical, not JSON or not an object', () => {
    const { S } = world();
    const { start, len } = frameOf(S);
    const text = new TextDecoder().decode(S.subarray(start + 4, start + 4 + len));
    expect(refusal(() => restoreOnto(economyFresh, S.slice(0, S.length - 1))).reason).toBe('truncated');
    const longer = new Uint8Array(S.length + 1);
    longer.set(S);
    expect(refusal(() => restoreOnto(economyFresh, longer)).reason).toBe('trailing bytes');
    const spaced = withSectionText(S, text.replace('{', '{ '));
    expect(refusal(() => restoreOnto(economyFresh, spaced)).reason).toBe('runtime section is not canonical JSON');
    const fraction = withSectionText(S, text.replace(/"intelValue":(-?\d+)/, '"intelValue":$1.5'));
    expect(refusal(() => restoreOnto(economyFresh, fraction)).reason).toBe('runtime section is not canonical JSON');
    const reordered = withSectionText(S, text.replace(/^\{("[a-zA-Z]+":)/, '{"zzz":0,$1'));
    expect(refusal(() => restoreOnto(economyFresh, reordered)).reason).toBe('runtime section is not canonical JSON');
    expect(refusal(() => restoreOnto(economyFresh, withSectionText(S, '{"a":'))).reason).toMatch(/^malformed/);
    expect(refusal(() => restoreOnto(economyFresh, withSectionText(S, '[1]'))).reason).toBe('runtime section is not an object');
    const keys = withSection(S, (s) => {
      delete s.purse;
    });
    expect(refusal(() => restoreOnto(economyFresh, keys)).reason).toBe('runtime section rows differ from the table');
    const extra = withSection(S, (s) => {
      s.zzExtra = 1;
    });
    expect(refusal(() => restoreOnto(economyFresh, extra)).reason).toBe('runtime section rows differ from the table');
  });

  it('refuses what the target\'s own setup contradicts or the table forbids, naming the row', () => {
    const { S } = world();
    const cases: [string, (s: Record<string, unknown>) => void, RegExp][] = [
      ['an entity id past the capacity', (s) => ((s.playerIds as number[])[0] = 32), /MissionRuntime\.playerIds\[\]: 32 is outside 0\.\.31/],
      ['a negative entity id', (s) => ((s.enemyIds as number[])[0] = -1), /enemyIds\[\]: -1 is outside/],
      ['a purse of the wrong length', (s) => (s.purse as number[]).push(0), /purse: length 3, this world has 2/],
      ['a typed element past its range', (s) => ((s.rearOk as number[])[0] = 256), /rearOk: element 256 is outside 0\.\.255/],
      ['a result outside its closed set', (s) => (s.resultValue = 'tie'), /resultValue: "tie" is not one of ongoing\|victory\|defeat/],
      ['an objective status outside its set', (s) => (((s.objectives as Record<string, unknown>[])[0]).status = 'nope'), /ObjectiveState\.status: "nope" is not one of/],
      ['an objective count the setup contradicts', (s) => (s.objectives as unknown[]).pop(), /objectives: 1 entries, this world has 2/],
      ['a boolean where an integer belongs', (s) => (s.intelValue = true), /intelValue: expected a 32-bit integer/],
      ['an integer where a boolean belongs', (s) => (s.ended = 1), /ended: expected a boolean/],
      ['a score above 100', (s) => (s.roeScoreValue = 101), /roeScoreValue: 101 is outside 0\.\.100/],
      ['a repeated Set member', (s) => (s.identified = [3, 3]), /identified: a repeated member/],
      ['a repeated Map key', (s) => (s.kills = [[1, 1], [1, 2]]), /kills: a repeated key/],
      ['a pair that is not a pair', (s) => (s.kills = [[1]]), /kills: a pair is not \[key, value\]/],
      ['a Map with a null key', (s) => (s.kills = [[null, 1]]), /kills\.key\(\): null where a value belongs/],
      ['a ventsKnown past the tunnels', (s) => (s.ventsKnown = 5), /ventsKnown: 5 is outside 0\.\.0/],
      ['a negative terrainVersion', (s) => (s.terrainVersion = -1), /terrainVersion/],
      ['a line count the setup contradicts', (s) => (s.lines as unknown[][])[0].pop(), /lines\[\]: \d+ entries, this world has \d+/],
      ['a corridor field outside the map', (s) => (s.corridorFields = [[99999, { stamp: 0 }]]), /goal tile 99999 is outside the map/],
      ['a corridor stamp from the future', (s) => (s.corridorFields = [[5, { stamp: 99 }]]), /CorridorField\.stamp: 99 is outside/],
      ['a zone route index out of range', (s) => (((s.incomeZoneList as Record<string, unknown>[])[0]).route = 7), /ZoneIncomeState\.route: index 7 is not an element of MissionRuntime\.zoneRoutes/],
      ['a record with a field missing', (s) => delete ((s.incomeZoneList as Record<string, unknown>[])[0]).holder, /fields differ from ZoneIncomeState/],
      ['a zone state outside its set', (s) => (((s.incomeZoneList as Record<string, unknown>[])[0]).state = 2), /ZoneIncomeState\.state: 2 is outside -2\.\.1/],
      ['an objective id that is not the mission\'s', (s) => (s.externallyCompleted = ['nope']), /externallyCompleted: "nope" is not an objective/],
      ['an event kind that does not exist', (s) => (s.pendingIntelEvents = [{ kind: 'zzz', tick: 1 }]), /a bad event/],
      [
        'a unit this world cannot build',
        (s) => (((s.lines as Record<string, unknown>[][])[0][0]).current = { unit: 'tank', logistics: 1, intel: 0, population: 1, buildTicks: 5 }),
        /LineItem\.unit: "tank" is not a unit this world can build/,
      ],
    ];
    for (const [what, edit, reason] of cases) {
      expect(refusal(() => restoreOnto(economyFresh, withSection(S, edit))).reason, what).toMatch(reason);
    }
  }, 60_000);

  it('a section refused at PLAN time leaves the target runtime untouched: the target is mid-run, so a stray write would show', () => {
    const { S } = world();
    // The target is a different world from the snapshot's (tick 300, not 500), so every row a refused restore wrote
    // would differ from what the target held. Cases refuse at four depths: a row decoded first, one decoded in the
    // middle of the record walk, one by the cross-row checks, and one only after every row is decoded.
    const cases: [string, (s: Record<string, unknown>) => void, RegExp][] = [
      ['an entity id past the capacity (an early row)', (s) => ((s.playerIds as number[])[0] = 32), /playerIds\[\]: 32 is outside/],
      ['an objective status outside its set (inside a record)', (s) => (((s.objectives as Record<string, unknown>[])[0]).status = 'nope'), /ObjectiveState\.status/],
      ['a corridor stamp from the future (the last check)', (s) => (s.corridorFields = [[5, { stamp: 99 }]]), /CorridorField\.stamp: 99 is outside/],
      [
        'a unit this world cannot build (after every row is decoded)',
        (s) => (((s.lines as Record<string, unknown>[][])[0][0]).current = { unit: 'tank', logistics: 1, intel: 0, population: 1, buildTicks: 5 }),
        /LineItem\.unit: "tank" is not a unit this world can build/,
      ],
    ];
    for (const [what, edit, reason] of cases) {
      const t = economySetup(ECONOMY_SEED);
      for (let k = 0; k < 300; k++) {
        economyDrive(t, k);
        economyAdvance(t, k);
      }
      const before = encodeRuntimeSection(t.rt, t.sim);
      const digestBefore = t.rt.digest();
      const fresh = economySetup(ECONOMY_SEED);
      expect(bytesEqual(before, encodeRuntimeSection(fresh.rt, fresh.sim)), `${what}: the target must differ from a fresh runtime`).toBe(false);
      expect(refusal(() => restoreSim(t.sim, withSection(S, edit), t.rt)).reason, what).toMatch(reason);
      expect(bytesEqual(encodeRuntimeSection(t.rt, t.sim), before), `${what}: the refusal left the runtime's section byte-equal`).toBe(true);
      expect(t.rt.digest(), `${what}: and its digest`).toBe(digestBefore);
    }
  }, 60_000);

  it('asks the unit catalogue per SIDE: a line\'s items are checked as the side that owns the line (a versus room keys its menus by side)', () => {
    let S: Uint8Array | null = null;
    walkSink((c) => {
      if (c.label === 'sink@40 (a forced completion owed)') S = encodeSim(c.sim, META, c.rt);
    });
    // The sink's side 1 buys from its own camp, so this snapshot holds items on BOTH sides' lines.
    const sec = sectionOf(S as unknown as Uint8Array);
    const held = (side: number): number => (sec.lines as { queue: unknown[]; current: unknown }[][])[side].reduce((n, l) => n + l.queue.length + (l.current === null ? 0 : 1), 0);
    expect(held(0), 'side 0 holds items').toBeGreaterThan(0);
    expect(held(1), 'side 1 holds items').toBeGreaterThan(0);
    // A catalogue that, like `versusUnitInfo`, indexes its menus by the side it is asked for (and throws without one).
    const target = (allowed: readonly [boolean, boolean]): World => {
      const w = sinkWorld();
      const ctx = props(props(w.rt).ctx);
      const base = ctx.unitInfo as (u: string, side: 0 | 1) => unknown;
      ctx.unitInfo = (u: string, side: 0 | 1): unknown => {
        if (side !== 0 && side !== 1) throw new TypeError(`unitInfo asked without a side (${String(side)})`);
        return allowed[side] ? base(u, side) : null;
      };
      return w;
    };
    const ok = target([true, true]);
    restoreSim(ok.sim, S as unknown as Uint8Array, ok.rt);
    for (const allowed of [[true, false], [false, true]] as const) {
      const w = target(allowed);
      expect(refusal(() => restoreSim(w.sim, S as unknown as Uint8Array, w.rt)).reason, `side ${allowed[0] ? 1 : 0} cannot build its items`).toMatch(
        /LineItem\.unit: "sink_squad" is not a unit this world can build/
      );
    }
  });

  it('refuses a ledger index that is not in the ledger, and a convoy the setup does not have', () => {
    let S: Uint8Array | null = null;
    walkSink((c) => {
      if (c.label === 'sink@40 (a forced completion owed)') S = encodeSim(c.sim, META, c.rt);
    });
    const snap = S as unknown as Uint8Array | null;
    expect(snap).not.toBeNull();
    const s = sectionOf(snap as Uint8Array);
    expect((s.entityRoster as unknown[][]).length, 'the sink world drew a roster entry').toBeGreaterThan(0);
    const badPool = withSection(snap as Uint8Array, (x) => (x.rosterPool = [9]));
    expect(refusal(() => restoreOnto(sinkWorld, badPool)).reason).toMatch(/rosterPool\[\]: index 9 is outside the ledger roster \(2\)/);
    const badDrawn = withSection(snap as Uint8Array, (x) => (x.entityRoster = [[3, 5]]));
    expect(refusal(() => restoreOnto(sinkWorld, badDrawn)).reason).toMatch(/entityRoster\.get\(\): index 5 is outside the ledger roster/);
    const noConvoy = withSection(snap as Uint8Array, (x) => (x.convoy = null));
    expect(refusal(() => restoreOnto(sinkWorld, noConvoy)).reason).toMatch(/convoy: this world has such a record/);
    // The golden economy has a convoy too; a world WITHOUT one refuses a snapshot that carries one.
    const eco = economySetup(ECONOMY_SEED);
    const withConvoy = encodeSim(eco.sim, META, eco.rt);
    const relief = reliefEconomySetup(RELIEF_ECO_SEED);
    expect(refusal(() => restoreSim(relief.sim, withConvoy, relief.rt)).reason).toBeTruthy();
  });

  it('refuses a works list that is not the one this mission builds', () => {
    let S: Uint8Array | null = null;
    walkSink((c) => {
      if (c.label === 'sink@2 (a works charge pending)') S = encodeSim(c.sim, META, c.rt);
    });
    const snap = S as unknown as Uint8Array | null;
    const s = sectionOf(snap as Uint8Array);
    expect((s.worksPending as unknown[]).length, 'a charge is pending').toBe(1);
    expect(refusal(() => restoreOnto(sinkWorld, withSection(snap as Uint8Array, (x) => (x.worksList = [])))).reason).toMatch(/worksList: 0 entries, this world has 1/);
    expect(refusal(() => restoreOnto(sinkWorld, withSection(snap as Uint8Array, (x) => (((x.worksOfferList as Record<string, unknown>[])[0]).left = 3)))).reason).toMatch(/WorksOffer\.left: 3 is outside 0\.\.2/);
    expect(refusal(() => restoreOnto(sinkWorld, withSection(snap as Uint8Array, (x) => (((x.worksPending as Record<string, unknown>[])[0]).structType = 99)))).reason).toMatch(/WorksCharge\.structType: 99 is outside/);
    expect(refusal(() => restoreOnto(sinkWorld, withSection(snap as Uint8Array, (x) => (x.worksPending = Array.from({ length: 1025 }, () => (x.worksPending as unknown[])[0]))))).reason).toMatch(/worksPending: 1025 entries, the limit is 1024/);
  });

  it('refuses corridor fields in a world that keeps no mask copies to compute them over', () => {
    const bare = (): World => {
      const sim = new Sim({ seed: 9, width: 16, height: 16, capacity: 8 });
      const rt = new MissionRuntime(
        sim,
        { id: 'bare', map: { file: 'none', player_start: [2, 2] }, ledger: { requires: [], produces: [] }, objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 60 }] },
        { typeIdOf: () => 0, markers: {}, zones: {} },
      );
      rt.start();
      return { sim, rt };
    };
    const w = bare();
    const S = encodeSim(w.sim, META, w.rt);
    restoreOnto(bare, S); // the clean one restores
    const bad = withSection(S, (s) => (s.corridorFields = [[5, { stamp: 0 }]]));
    expect(refusal(() => restoreOnto(bare, bad)).reason).toMatch(/fields without the mask copies/);
  });

  it('encode throws a plain Error, not a refusal, on a runtime the table does not allow', () => {
    const w = economySetup(ECONOMY_SEED);
    props(w.rt).roeScoreValue = 1.5;
    expect(() => encodeSim(w.sim, META, w.rt)).toThrow(/roeScoreValue is not an i32/);
    try {
      encodeSim(w.sim, META, w.rt);
    } catch (e) {
      expect(e).not.toBeInstanceOf(SnapshotRefused);
    }
    const v = economySetup(ECONOMY_SEED);
    props(v.rt).roeScoreValue = 101; // an integer, but a score the decoder would refuse
    expect(() => encodeSim(v.sim, META, v.rt)).toThrow(/would be refused on restore.*roeScoreValue: 101 is outside 0\.\.100/);
  });
});

// ---- the shapes the codec promises -----------------------------------------------------------------------

describe('runtime snapshot: Map and Set insertion order is kept, never sorted', () => {
  it('a Map filled in reverse order restores in reverse order', () => {
    const MAPS = ['groups', 'tags', 'kills', 'identifiedBy'];
    let S: Uint8Array | null = null;
    const orders: Record<string, unknown[]> = {};
    walkSink((c) => {
      if (c.label === 'sink@40 (a forced completion owed)') {
        for (const name of MAPS) {
          const m = props(c.rt)[name] as Map<unknown, unknown>;
          const entries = [...m].reverse();
          m.clear();
          for (const [k, v] of entries) m.set(k, v);
          orders[name] = [...m.keys()];
        }
        const ident = props(c.rt).identified as Set<number>;
        const members = [...ident].reverse();
        ident.clear();
        for (const x of members) ident.add(x);
        orders.identified = [...ident];
        S = encodeSim(c.sim, META, c.rt);
      }
    });
    expect(S).not.toBeNull();
    const { world } = restoreOnto(sinkWorld, S as unknown as Uint8Array);
    for (const name of MAPS) expect([...(props(world.rt)[name] as Map<unknown, unknown>).keys()], name).toEqual(orders[name]);
    expect([...(props(world.rt).identified as Set<number>)]).toEqual(orders.identified);
    // Non-vacuous: the order is not the sorted one for at least one of them (so sorting would be seen).
    const sorted = (xs: unknown[]): unknown[] => [...xs].sort();
    expect(Object.values(orders).some((o) => o.length > 1 && JSON.stringify(o) !== JSON.stringify(sorted(o)))).toBe(true);
  });
});

describe('runtime snapshot: identity, aliases and the corridor fields', () => {
  it('keeps every container\'s identity, restores corridorFields in place, and the closure still reaches the restored Map', () => {
    const a = economySetup(ECONOMY_SEED);
    for (let t = 0; t < 900; t++) {
      economyDrive(a, t);
      economyAdvance(a, t);
    }
    const S = encodeSim(a.sim, META, a.rt);
    const b = economySetup(ECONOMY_SEED);
    const before = new Map<string, unknown>();
    for (const [k, v] of Object.entries(props(b.rt))) if (v !== null && typeof v === 'object') before.set(k, v);
    const fieldsBefore = props(b.rt).corridorFields as Map<number, unknown>;
    restoreSim(b.sim, S, b.rt);
    for (const [k, v] of before) {
      // The runtime's own objects keep their identity (the ones a restore must not replace); the few rows that are
      // reassigned by the runtime itself (nullable routes, the vents copy) are allowed to be a new object.
      if (['convoyRouteCache', 'ventXY'].includes(k)) continue;
      expect(props(b.rt)[k], `${k} keeps its identity`).toBe(v);
    }
    expect(props(b.rt).corridorFields).toBe(fieldsBefore);
    const fieldsA = props(a.rt).corridorFields as Map<number, { field: Record<string, unknown>; stamp: number }>;
    const fieldsB = props(b.rt).corridorFields as Map<number, { field: Record<string, unknown>; stamp: number }>;
    expect(fieldsA.size, 'the replay computed corridor fields').toBeGreaterThan(0);
    expect([...fieldsB.keys()], 'keys, in order').toEqual([...fieldsA.keys()]);
    for (const [key, ea] of fieldsA) {
      const eb = fieldsB.get(key);
      expect(eb?.stamp, `stamp of ${key}`).toBe(ea.stamp);
      if (ea.stamp === props(a.rt).terrainVersion) {
        for (const col of ['dirs', 'cost'] as const) {
          expect(Array.from(eb?.field[col] as Uint8Array), `field ${key}.${col}`).toEqual(Array.from(ea.field[col] as Uint8Array));
        }
        expect(eb?.field.goalX).toBe(ea.field.goalX);
        expect(eb?.field.goalY).toBe(ea.field.goalY);
      }
    }
    const probe = probeClosures(b.rt, b.sim);
    expect(probe.complaints).toEqual([]);
    expect(probe.used).toEqual(['RouteSource.fieldFor -> MissionRuntime.corridorFields']);
    // A view stays the target's OWN column.
    expect((props(b.rt).holdView as { alive: unknown }).alive).toBe(b.sim.state.alive);
  });

  it('corridor fields are recomputed over the runtime\'s mask copies, not the sim\'s masks of the snapshot tick (a site staked and cancelled inside one recheck window)', () => {
    const sameBytes = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
    const compare = (label: string, a: World, b: World): number => {
      const fa = props(a.rt).corridorFields as Map<number, { field: Record<string, unknown>; stamp: number }>;
      const fb = props(b.rt).corridorFields as Map<number, { field: Record<string, unknown>; stamp: number }>;
      expect([...fb.keys()], `${label}: keys`).toEqual([...fa.keys()]);
      let compared = 0;
      for (const [key, ea] of fa) {
        const eb = fb.get(key);
        expect(eb?.stamp, `${label}: stamp of ${key}`).toBe(ea.stamp);
        if (ea.stamp !== props(a.rt).terrainVersion) continue; // a stale entry is recomputed whole before it is read
        expect(sameBytes(eb?.field.dirs as Uint8Array, ea.field.dirs as Uint8Array), `${label}: dirs of ${key}`).toBe(true);
        expect(sameBytes(eb?.field.cost as Int32Array, ea.field.cost as Int32Array), `${label}: cost of ${key}`).toBe(true);
        compared++;
      }
      return compared;
    };
    const RAISE = 21;
    const a = sinkWorld();
    let b: World | null = null;
    let snapAt = -1;
    let compared = 0;
    for (let t = 1; t <= 300; t++) {
      const r = props(a.rt);
      if (snapAt < 0 && t > RAISE && !sameBytes(r.seenVehicle as Uint8Array, a.sim.blockedVehicle) && t % 20 < 17) {
        snapAt = t;
        // Inside the window: the sim's vehicle mask has moved on from the copies the fields were computed over.
        b = restoreOnto(sinkWorld, encodeSim(a.sim, META, a.rt)).world;
        compared += compare(`restore tick ${t}`, a, b);
      }
      for (const w of b === null ? [a] : [a, b]) {
        if (t === RAISE) expect(w.rt.requestConstruct('sink_outpost', 13, 10)).toBe(true);
        if (snapAt > 0 && t === snapAt + 1) {
          for (const site of [...(props(w.rt).worksSites as Map<number, unknown>).keys()]) expect(w.rt.requestCancelWorks(site)).toBe(true);
        }
        w.rt.step(w.sim.tick());
      }
      if (b !== null && t % 10 === 0) {
        expect(b.rt.digest(), `tick ${t}: digest`).toBe(a.rt.digest());
        expect(b.sim.hash(), `tick ${t}: sim.hash`).toBe(a.sim.hash());
      }
    }
    expect(snapAt, 'a snapshot tick between a staking and its next recheck was found').toBeGreaterThan(RAISE);
    expect(b).not.toBeNull();
    compared += compare('tick 300', a, b as World);
    expect(compared, 'fields were compared').toBeGreaterThan(2);
    expect(bytesEqual(encodeSim(a.sim, META, a.rt), encodeSim((b as World).sim, META, (b as World).rt))).toBe(true);
  }, 60_000);

  it('the restored aliases are the target\'s own objects: zone routes, the convoy, spans, the ledger roster', () => {
    let S: Uint8Array | null = null;
    walkSink((c) => {
      if (c.label === 'sink@40 (a forced completion owed)') S = encodeSim(c.sim, META, c.rt);
    });
    const { world } = restoreOnto(sinkWorld, S as unknown as Uint8Array);
    const r = props(world.rt);
    const zones = r.incomeZoneList as { route: unknown; cutSpan: unknown; spanStore: unknown }[];
    const zoneRoutes = r.zoneRoutes as unknown[];
    for (const z of zones) {
      if (z.route !== null) expect(zoneRoutes.includes(z.route), 'zone.route is an element of zoneRoutes').toBe(true);
      if (z.cutSpan !== null) expect(z.cutSpan).toBe(z.spanStore);
    }
    const convoy = r.convoy as { route: unknown; cutSpan: unknown };
    if (convoy.route !== null) expect(convoy.route).toBe(r.convoyRouteCache);
    if (convoy.cutSpan !== null) expect(convoy.cutSpan).toBe(r.convoySpanStore);
    const ledger = (props(r.ctx).ledger as Record<string, unknown[]>)['roster.surviving_units'];
    for (const entry of r.rosterPool as unknown[]) expect(ledger.includes(entry), 'a pool entry is a ledger element').toBe(true);
    const drawn = [...(r.entityRoster as Map<number, unknown>).values()];
    expect(drawn.length).toBeGreaterThan(0);
    for (const entry of drawn) expect(ledger.includes(entry), 'a drawn entry is a ledger element').toBe(true);
    // Non-vacuous: this checkpoint has a held zone with a route, so the zone half of the loop above ran.
    expect(zones.some((z) => z.route !== null) || zones.some((z) => z.cutSpan !== null), 'a zone with a route or a span').toBe(true);
  });
});

describe('runtime snapshot: the dock\'s lazy works list', () => {
  const field = (w: World): { list: unknown; offers: unknown[] } => ({ list: props(w.rt).worksList, offers: props(w.rt).worksOfferList as unknown[] });

  it('two worlds identical except that one had worksOffers() read encode byte-equal, and the source is not built by encoding', () => {
    const a = sinkWorld();
    const b = sinkWorld();
    for (let t = 0; t < 5; t++) {
      a.rt.step(a.sim.tick());
      b.rt.step(b.sim.tick());
    }
    expect(field(a).list, 'unbuilt before the read').toBeNull();
    const S = encodeSim(a.sim, META, a.rt);
    expect(field(a).list, 'encoding did not build the source').toBeNull();
    expect(field(a).offers, 'nor fill its offer list').toEqual([]);
    expect(b.rt.worksOffers().length, 'the dock read: one offer').toBe(1);
    expect(field(b).list).not.toBeNull();
    expect(bytesEqual(encodeSim(b.sim, META, b.rt), S), 'built and unbuilt encode alike').toBe(true);
    // A restore carries the built form: the offers are listed, with their counts.
    const { world, again } = restoreOnto(sinkWorld, S);
    expect(field(world).list).not.toBeNull();
    expect(world.rt.worksOffers().map((o) => ({ ...o }))).toEqual(b.rt.worksOffers().map((o) => ({ ...o })));
    expect(bytesEqual(again, S)).toBe(true);
  });

  it('a spent offer count (left) round-trips, and the restored dock is the source\'s', () => {
    const a = sinkWorld();
    a.rt.step(a.sim.tick());
    expect(a.rt.requestConstruct('sink_outpost', 13, 10)).toBe(true);
    expect(a.rt.worksOffers()[0].left).toBe(1);
    const S = encodeSim(a.sim, META, a.rt);
    const { world } = restoreOnto(sinkWorld, S);
    expect(world.rt.worksOffers()[0].left).toBe(1);
    expect(world.rt.worksOffers()[0].max).toBe(2);
    // Both worlds go on to refuse the same third request.
    expect(world.rt.requestConstruct('sink_outpost', 20, 10)).toBe(a.rt.requestConstruct('sink_outpost', 20, 10));
    expect(world.rt.requestConstruct('sink_outpost', 24, 10)).toBe(a.rt.requestConstruct('sink_outpost', 24, 10));
  });
});

// ---- the fuzz ------------------------------------------------------------------------------------------------------

describe('runtime snapshot: fuzz', () => {
  it('1,000 seeded mutations: each is a clean refusal or a canonical world, and no ArrayBuffer growth past 4 MiB', () => {
    let base: Uint8Array | null = null;
    walkSink((c) => {
      if (c.label === 'sink@40 (a forced completion owed)') base = encodeSim(c.sim, META, c.rt);
    });
    const good = base as unknown as Uint8Array | null;
    expect(good).not.toBeNull();
    const S = good as Uint8Array;
    const { start, len } = frameOf(S);
    const section = sectionOf(S);
    expect(len, 'a non-trivial section').toBeGreaterThan(2000);

    const rng = new Rng(0xf0e2, 1);
    const draw = (n: number): number => rng.nextU32(0) % n;

    // A random JSON edit: pick a node in the parsed section and change it.
    const jsonEdit = (): Uint8Array => {
      const root = JSON.parse(JSON.stringify(section)) as Record<string, unknown>;
      const nodes: { parent: Record<string, unknown> | unknown[]; key: string | number }[] = [];
      const walk = (v: unknown, depth: number): void => {
        if (v === null || typeof v !== 'object' || depth > 6) return;
        const entries: [string | number, unknown][] = Array.isArray(v) ? v.map((x, i): [number, unknown] => [i, x]) : Object.entries(v as Record<string, unknown>);
        for (const [k, child] of entries) {
          nodes.push({ parent: v as Record<string, unknown> | unknown[], key: k });
          walk(child, depth + 1);
        }
      };
      walk(root, 0);
      const { parent, key } = nodes[draw(nodes.length)];
      const slot = parent as Record<string | number, unknown>;
      const cur = slot[key];
      const how = draw(9);
      if (how === 0 && typeof cur === 'number') slot[key] = cur + 1;
      else if (how === 1 && typeof cur === 'number') slot[key] = cur - 1;
      else if (how === 2 && typeof cur === 'number') slot[key] = [0, -1, 31, 32, 255, 256, 2147483647, -2147483648][draw(8)];
      else if (how === 3 && typeof cur === 'boolean') slot[key] = !cur;
      else if (how === 4) slot[key] = null;
      else if (how === 5) slot[key] = typeof cur === 'string' ? cur + 'x' : 'x';
      else if (how === 6 && !Array.isArray(parent)) delete slot[key];
      else if (how === 7 && Array.isArray(parent)) parent.splice(draw(parent.length + 1), 0, parent.length > 0 ? parent[draw(parent.length)] : 0);
      else if (how === 8 && Array.isArray(parent) && parent.length > 1) {
        const i = draw(parent.length);
        const j = draw(parent.length);
        [parent[i], parent[j]] = [parent[j], parent[i]];
      } else slot[key] = typeof cur === 'number' ? cur + 2 : cur;
      return withSectionText(S, canonicalJson(root));
    };

    const kinds = ['truncate', 'bitflip', 'oversized', 'garbage-section', 'append', 'json-edit', 'header'] as const;
    const tally: Record<string, { refused: number; accepted: number }> = {};
    for (const k of kinds) tally[k] = { refused: 0, accepted: 0 };
    let sections = 0;

    for (let i = 0; i < 1000; i++) {
      const kind = kinds[i % kinds.length];
      let m: Uint8Array;
      if (kind === 'truncate') {
        m = S.slice(0, start + draw(len + 4));
      } else if (kind === 'bitflip') {
        m = S.slice();
        m[start + 4 + draw(len)] ^= 1 << draw(8);
      } else if (kind === 'oversized') {
        m = S.slice();
        new DataView(m.buffer).setUint32(start, [0xffffffff, 0x7fffffff, 0x10000000, len + 1, len - 1, MAX_RUNTIME_BYTES + 1][draw(6)], true);
      } else if (kind === 'garbage-section') {
        const garbage = new Uint8Array(draw(300));
        for (let g = 0; g < garbage.length; g++) garbage[g] = draw(256);
        m = new Uint8Array(start + 4 + garbage.length);
        m.set(S.subarray(0, start));
        new DataView(m.buffer).setUint32(start, garbage.length, true);
        m.set(garbage, start + 4);
      } else if (kind === 'append') {
        const extra = new Uint8Array(1 + draw(40));
        for (let g = 0; g < extra.length; g++) extra[g] = draw(256);
        m = new Uint8Array(S.length + extra.length);
        m.set(S);
        m.set(extra, S.length);
      } else if (kind === 'json-edit') {
        m = jsonEdit();
      } else {
        // The header words: hasRuntime, the runtime digest, the sim digest and the lengths.
        m = S.slice();
        m[[SNAPSHOT_FIXED_HEADER_BYTES - 5, SNAPSHOT_FIXED_HEADER_BYTES - 4, SNAPSHOT_FIXED_HEADER_BYTES - 3, SNAPSHOT_FIXED_HEADER_BYTES - 1, 6, 7][draw(6)]] ^= 1 << draw(8);
      }
      const target = sinkWorld();
      const mem0 = process.memoryUsage().arrayBuffers;
      let meta: ReturnType<typeof restoreSim> | null = null;
      try {
        meta = restoreSim(target.sim, m, target.rt);
      } catch (e) {
        expect(e, `case ${i} (${kind}) threw something other than SnapshotRefused`).toBeInstanceOf(SnapshotRefused);
      }
      const grown = process.memoryUsage().arrayBuffers - mem0;
      expect(grown, `case ${i} (${kind}) allocated ${grown} bytes`).toBeLessThan(4 * 1024 * 1024);
      if (meta === null) {
        tally[kind].refused++;
      } else {
        tally[kind].accepted++;
        sections++;
        // An accepted mutation is a valid, canonical world: it encodes again, and to the very bytes it came from.
        expect(bytesEqual(encodeSim(target.sim, meta, target.rt), m), `case ${i} (${kind}) was accepted but is not canonical`).toBe(true);
      }
    }
    const refused = kinds.reduce((n, k) => n + tally[k].refused, 0);
    const accepted = kinds.reduce((n, k) => n + tally[k].accepted, 0);
    expect(refused + accepted).toBe(1000);
    // Not vacuous: most are refused, and some JSON edits land on a value that is still legal and are accepted.
    expect(refused).toBeGreaterThan(600);
    expect(tally['json-edit'].accepted).toBeGreaterThan(5);
    expect(tally['json-edit'].refused).toBeGreaterThan(40);
    expect(tally.append.accepted).toBe(0);
    expect(tally.truncate.accepted).toBe(0);
    expect(tally['garbage-section'].accepted).toBe(0);
    expect(sections).toBeGreaterThan(5);
  }, 240000);
});
