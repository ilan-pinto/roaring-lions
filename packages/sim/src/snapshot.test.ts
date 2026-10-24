import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { runDrive, runSetup } from './golden-worlds.test-helper';
import { Rng } from './rng';
import { Sim } from './sim';
import { SIM_SNAPSHOT_SCHEMA, rowsOf } from './snapshot-schema';
import { SNAPSHOT_FORMAT, SnapshotRefused, canonicalJson, encodeSim, restoreSim, snapshotSchemaDigest } from './snapshot';
import * as simIndex from './index';

// The encoder and the restore (net sim snapshot S1, Task 3). The worlds are the
// golden replay's: the 1000-tick battle (a shed collapses at about tick 300, so
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
        restoreSim(fresh, S);
        expect(bytesEqual(encodeSim(fresh), S), `tick ${T}: re-encode`).toBe(true);
        if (T > 0) expect(bytesEqual(before, S), `tick ${T}: the fresh world already equalled the snapshot, so the test proves nothing`).toBe(false);
        expect(fresh.tickCount).toBe(T);
        expect(fresh.hash(), `tick ${T}: hash`).toBe(a.sim.hash());
        expect(props(fresh).posX, 'columns are written in place, so views stay aliased').toBe(aliased);
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

describe('snapshot: the encoder refuses at a boundary that is not between frames', () => {
  it('throws when a command is queued', () => {
    const sim = runSetup(SEED).sim;
    sim.queueCommand({ kind: 'halt', ids: [0] });
    expect(() => encodeSim(sim)).toThrow(/queued/);
  });
  it('throws when the runtime queue holds something', () => {
    const sim = runSetup(SEED).sim;
    (props(sim).runtimeQueue as unknown[]).push({ kind: 'halt', ids: [0] });
    expect(() => encodeSim(sim)).toThrow(/queued/);
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
    const ok = encodeSim(sim, { build: 'x'.repeat(256) });
    const b = ok.slice();
    // build length u16 sits at 10; make it 257 (and the stream no longer lines up)
    b[10] = 1;
    b[11] = 1;
    expect(refusal(() => restoreSim(runSetup(SEED).sim, b)).reason).toMatch(/build/);
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
});

describe('snapshot: fuzz', () => {
  it('2,000 seeded mutations: each is a clean refusal or a canonical world, and none allocates past 4 MiB', () => {
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
