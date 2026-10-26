import { describe, it, expect } from 'vitest';
import { admitTick, decide, newestSnapshotTickBelow, PendingBook, ReservationBook, type Pending } from './snapshot-intake';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const pend = (sha: string, digest = 0xdeadbeef, byte = 0): Pending => ({ sha, digest, body: new Uint8Array([byte]) });

describe('newestSnapshotTickBelow', () => {
  it('is the last cadence tick strictly below the room tick, or -1', () => {
    expect(newestSnapshotTickBelow(1200, 1200)).toBe(1199);
    expect(newestSnapshotTickBelow(1201, 1200)).toBe(1199);
    expect(newestSnapshotTickBelow(2400, 1200)).toBe(2399);
    expect(newestSnapshotTickBelow(1199, 1200)).toBe(-1);
    expect(newestSnapshotTickBelow(0, 1200)).toBe(-1);
  });
});

describe('admitTick (every 1200)', () => {
  const base = { every: 1200, roomTick: 2500, storedTick: -1 };
  it('admits a minted cadence tick', () => {
    expect(admitTick(2399, base)).toBe('ok');
    expect(admitTick(1199, base)).toBe('ok');   // the window edge: newest 2399 - 1200
  });
  it('refuses a tick off the cadence', () => {
    expect(admitTick(1200, base)).toBe('stale');
    expect(admitTick(0, base)).toBe('stale');
    expect(admitTick(2398, base)).toBe('stale');
    expect(admitTick(-1, base)).toBe('stale');
  });
  it('refuses a tick the room has not minted yet', () => {
    expect(admitTick(2399, { ...base, roomTick: 2399 })).toBe('stale');
    expect(admitTick(2399, { ...base, roomTick: 2400 })).toBe('ok');
    expect(admitTick(3599, base)).toBe('stale');
  });
  it('refuses a tick no newer than the stored one', () => {
    expect(admitTick(2399, { ...base, storedTick: 2399 })).toBe('stale');
    expect(admitTick(2399, { ...base, storedTick: 1199 })).toBe('ok');
    expect(admitTick(1199, { ...base, storedTick: 2399 })).toBe('stale');
  });
  it('refuses a tick one interval older than the two-tick window', () => {
    // roomTick 3700: newest below is 3599; window floor 2399.
    const r = { every: 1200, roomTick: 3700, storedTick: -1 };
    expect(admitTick(3599, r)).toBe('ok');
    expect(admitTick(2399, r)).toBe('ok');
    expect(admitTick(1199, r)).toBe('stale');
  });
  it('the first snapshot of a young room is admissible', () => {
    expect(admitTick(1199, { every: 1200, roomTick: 1200, storedTick: -1 })).toBe('ok');
    expect(admitTick(1199, { every: 1200, roomTick: 1199, storedTick: -1 })).toBe('stale');
  });
});

describe('PendingBook', () => {
  it('records per seat and tick', () => {
    const b = new PendingBook();
    expect(b.has(0, 39)).toBe(false);
    b.put(0, 39, pend(SHA_A));
    expect(b.has(0, 39)).toBe(true);
    expect(b.has(1, 39)).toBe(false);
    expect(b.has(0, 79)).toBe(false);
    expect(b.get(0, 39)?.sha).toBe(SHA_A);
  });
  it('never holds more than two distinct ticks; a newer third drops the oldest', () => {
    const b = new PendingBook();
    b.put(0, 39, pend(SHA_A));
    b.put(1, 39, pend(SHA_A));
    b.put(0, 79, pend(SHA_A));
    expect(b.ticks()).toEqual([39, 79]);
    b.put(0, 119, pend(SHA_A));
    expect(b.ticks()).toEqual([79, 119]);
    expect(b.has(0, 39)).toBe(false);
    expect(b.has(1, 39)).toBe(false);
  });
  it('a third tick older than both is the one dropped', () => {
    const b = new PendingBook();
    b.put(0, 79, pend(SHA_A));
    b.put(0, 119, pend(SHA_A));
    b.put(1, 39, pend(SHA_A));
    expect(b.ticks()).toEqual([79, 119]);
  });
  it('drop removes one tick; dropThrough removes every tick up to and including it', () => {
    const b = new PendingBook();
    b.put(0, 39, pend(SHA_A));
    b.put(0, 79, pend(SHA_A));
    b.drop(79);
    expect(b.ticks()).toEqual([39]);
    b.put(0, 79, pend(SHA_A));
    b.dropThrough(39);
    expect(b.ticks()).toEqual([79]);
    b.dropThrough(79);
    expect(b.ticks()).toEqual([]);
  });
  it('two seats at two ticks is four entries and no more', () => {
    const b = new PendingBook();
    for (const t of [39, 79]) for (const s of [0, 1] as const) b.put(s, t, pend(SHA_A));
    for (const t of [39, 79]) for (const s of [0, 1] as const) expect(b.has(s, t)).toBe(true);
    expect(b.ticks()).toHaveLength(2);
  });
});

describe('ReservationBook (security review)', () => {
  it('a slot is taken once a seat and tick; the other seat and another tick are separate slots', () => {
    const b = new ReservationBook();
    expect([b.reserve(0, 39), b.reserve(0, 39), b.reserve(1, 39), b.reserve(0, 79)]).toEqual([true, false, true, true]);
    expect([b.has(0, 39), b.has(1, 79), b.has(1, 39)]).toEqual([true, false, true]);
  });
  it('holds the two newest ticks, forgets the oldest, and clears', () => {
    const b = new ReservationBook();
    for (const t of [39, 79, 119]) b.reserve(0, t);
    expect(b.ticks()).toEqual([79, 119]);
    expect(b.has(0, 39)).toBe(false);
    b.dropThrough(79);
    expect(b.ticks()).toEqual([119]);
    b.clear();
    expect(b.ticks()).toEqual([]);
  });
});

describe('decide', () => {
  const bookOf = (a?: Pending, b?: Pending): PendingBook => {
    const k = new PendingBook();
    if (a) k.put(0, 39, a);
    if (b) k.put(1, 39, b);
    return k;
  };
  it('holds while a seat is missing', () => {
    expect(decide(bookOf(pend(SHA_A)), 39, 0)).toEqual({ kind: 'held' });
    expect(decide(bookOf(undefined, pend(SHA_A)), 39, 0)).toEqual({ kind: 'held' });
    expect(decide(bookOf(), 39, 0)).toEqual({ kind: 'held' });
  });
  it('holds on equal SHAs until the digest is agreed', () => {
    expect(decide(bookOf(pend(SHA_A), pend(SHA_A)), 39, undefined)).toEqual({ kind: 'held' });
  });
  it('a differing SHA is a mismatch at once, agreed or not', () => {
    const want = { kind: 'mismatch', why: 'sha', shas: [SHA_A, SHA_B], digest: 0xdeadbeef };
    expect(decide(bookOf(pend(SHA_A), pend(SHA_B)), 39, undefined)).toEqual(want);
    expect(decide(bookOf(pend(SHA_A), pend(SHA_B)), 39, -559038737)).toEqual(want);
  });
  it('accepts equal SHAs whose header digest is the agreed one, keeping seat 0\'s body', () => {
    const d = decide(bookOf(pend(SHA_A, 0xdeadbeef, 1), pend(SHA_A, 0xdeadbeef, 2)), 39, -559038737);
    expect(d.kind).toBe('accept');
    if (d.kind !== 'accept') return;
    expect(d.sha).toBe(SHA_A);
    expect(d.digest).toBe(3735928559);
    expect([...d.body]).toEqual([1]);
  });
  it('compares a negative agreed hash with the u32 header word (-559038737 is 0xdeadbeef)', () => {
    expect(decide(bookOf(pend(SHA_A, 3735928559), pend(SHA_A, 3735928559)), 39, -559038737).kind).toBe('accept');
    expect(decide(bookOf(pend(SHA_A, 5), pend(SHA_A, 5)), 39, 5).kind).toBe('accept');
    expect(decide(bookOf(pend(SHA_A, 0), pend(SHA_A, 0)), 39, 0).kind).toBe('accept');
  });
  it('equal SHAs with a header digest other than the agreed one is a digest mismatch', () => {
    expect(decide(bookOf(pend(SHA_A, 3735928559), pend(SHA_A, 3735928559)), 39, 77)).toEqual({
      kind: 'mismatch', why: 'digest', shas: [SHA_A, SHA_A], digest: 3735928559,
    });
  });
});
