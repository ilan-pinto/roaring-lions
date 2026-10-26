import { describe, it, expect, afterEach } from 'vitest';
import { constants, gunzipSync, gzipSync } from 'node:zlib';
import { Sim, encodeSim } from '@lions/sim';
import {
  SNAPSHOT_FRAME_TICK_OFFSET, SNAPSHOT_MAX_COMPRESSED_BYTES, SNAPSHOT_MAX_RAW_BYTES,
  gunzipCapped, readSnapshotHeader, sha256Hex,
} from './snapshot-wire';

describe('snapshot wire constants', () => {
  it('pin the caps and the frameTick offset to literals', () => {
    expect(SNAPSHOT_MAX_COMPRESSED_BYTES).toBe(65_536);
    expect(SNAPSHOT_MAX_RAW_BYTES).toBe(1_048_576);
    expect(SNAPSHOT_FRAME_TICK_OFFSET).toBe(18);
  });
});

describe('SNAPSHOT_FORMAT re-export', () => {
  it('the package index names the format, pinned to the literal 1 (the worker reads it from here)', async () => {
    const net = await import('./index');
    expect(net.SNAPSHOT_FORMAT).toBe(1);
  });
});

describe('readSnapshotHeader', () => {
  const snap = () => encodeSim(new Sim({ seed: 1, width: 8, height: 8, capacity: 4 }),
    { matchDigest: 0xdeadbeef, frameTick: 1199, build: 'b', matchId: 'ABCDEF' });

  it('reads the real encoder\'s format, matchDigest and frameTick (not contentDigest)', () => {
    expect(readSnapshotHeader(snap())).toEqual({ format: 1, matchDigest: 3735928559, frameTick: 1199 });
  });
  it('refuses a wrong magic and a truncated header', () => {
    const bad = snap().slice();
    bad[0] = 0x58;
    expect(readSnapshotHeader(bad)).toBeNull();
    expect(readSnapshotHeader(snap().slice(0, 10))).toBeNull();
    expect(readSnapshotHeader(new Uint8Array(0))).toBeNull();
  });
  it('needs room for the whole frameTick word: 21 bytes is null, 22 reads', () => {
    expect(readSnapshotHeader(snap().slice(0, 21))).toBeNull();
    expect(readSnapshotHeader(snap().slice(0, 22))).toEqual({ format: 1, matchDigest: 3735928559, frameTick: 1199 });
  });
  it('reads a view onto a larger buffer by its own offset', () => {
    const s = snap();
    const wide = new Uint8Array(s.byteLength + 7);
    wide.set(s, 7);
    expect(readSnapshotHeader(wide.subarray(7))?.frameTick).toBe(1199);
  });
});

describe('gunzipCapped', () => {
  const MAX = 1_048_576;
  const real = globalThis.DecompressionStream;
  afterEach(() => { globalThis.DecompressionStream = real; });

  it('admits exactly the ceiling and refuses one byte more', async () => {
    const exact = await gunzipCapped(gzipSync(new Uint8Array(MAX)), MAX);
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.bytes.byteLength).toBe(1_048_576);
    expect(await gunzipCapped(gzipSync(new Uint8Array(MAX + 1)), MAX)).toEqual({ ok: false, reason: 'too_large' });
  });
  it('round-trips ordinary bytes unchanged', async () => {
    const src = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) & 0xff);
    const r = await gunzipCapped(gzipSync(src), MAX);
    expect(r.ok && Buffer.compare(Buffer.from(r.bytes), Buffer.from(src))).toBe(0);
  });
  it('a 4 MiB all-zero bomb is too_large, the reader is cancelled, and no more than max + one chunk was pulled', async () => {
    const bomb = gzipSync(new Uint8Array(4 * 1024 * 1024));
    expect(bomb.byteLength).toBeLessThan(8 * 1024);
    let pulled = 0, biggest = 0, cancelled = false;
    globalThis.DecompressionStream = class Spy {
      readonly writable: WritableStream<BufferSource>;
      readonly readable: ReadableStream<Uint8Array>;
      constructor(fmt: CompressionFormat) {
        const ds = new real(fmt);
        this.writable = ds.writable;
        const rd = ds.readable;
        this.readable = new Proxy(rd, {
          get(t, k) {
            if (k === 'getReader') {
              return () => {
                const r = t.getReader();
                return {
                  read: async () => {
                    const x = await r.read();
                    if (x.value) { pulled += x.value.byteLength; biggest = Math.max(biggest, x.value.byteLength); }
                    return x;
                  },
                  cancel: (why?: unknown) => { cancelled = true; return r.cancel(why); },
                };
              };
            }
            const v: unknown = Reflect.get(t, k, t);
            return typeof v === 'function' ? v.bind(t) : v;
          },
        });
      }
    } as unknown as typeof DecompressionStream;
    expect(await gunzipCapped(bomb, MAX)).toEqual({ ok: false, reason: 'too_large' });
    expect(cancelled).toBe(true);
    expect(pulled).toBeGreaterThan(MAX);
    expect(pulled).toBeLessThanOrEqual(MAX + biggest);
  });
  /** A DecompressionStream that behaves as the Worker runtime's does: each write is inflated at once and its output queued,
   *  whatever the reader has asked for. It records the compressed bytes it accepted. */
  function installEagerInflater(lagTurns = 0, lagTimer = false): { accepted: () => number } {
    let accepted = 0;
    globalThis.DecompressionStream = class Eager {
      readonly writable: WritableStream<BufferSource>;
      readonly readable: ReadableStream<Uint8Array>;
      constructor() {
        let ctl!: ReadableStreamDefaultController<Uint8Array>;
        this.readable = new ReadableStream<Uint8Array>({ start(c) { ctl = c; } }, { highWaterMark: Infinity });
        const input: Buffer[] = [];
        let out = 0;
        let queued: Promise<void> = Promise.resolve();
        this.writable = new WritableStream<BufferSource>({
          write(chunk) {
            const b = Buffer.from(chunk as Uint8Array);
            accepted += b.byteLength;
            input.push(b);
            let whole: Buffer;
            try { whole = gunzipSync(Buffer.concat(input), { finishFlush: constants.Z_SYNC_FLUSH }); } catch (e) { ctl.error(e); throw e; }
            const from = out;
            out = whole.byteLength;
            // The write is taken at once; with a lag the output shows a few promise turns later.
            queued = queued.then(async () => {
              for (let i = 0; i < lagTurns; i++) await undefined;
              // A runtime that shows inflate output on a later event-loop turn, not a later promise turn.
              if (lagTimer) await new Promise<void>((r) => setTimeout(r, 0));
              for (let at = from; at < whole.byteLength; at += 65536) ctl.enqueue(whole.subarray(at, Math.min(at + 65536, whole.byteLength)));
            });
          },
          async close() {
            await queued;
            try { gunzipSync(Buffer.concat(input)); } catch (e) { ctl.error(e); return; }
            ctl.close();
          },
        });
      }
    } as unknown as typeof DecompressionStream;
    return { accepted: () => accepted };
  }
  it('security review: the largest admissible bomb (64 KiB of gzip, about 64 MiB inflated) is refused after at most two 4 KiB slices were accepted, with no unhandled rejection', async () => {
    const bomb = gzipSync(new Uint8Array(64 * 1024 * 1024), { level: 9 });
    expect(bomb.byteLength).toBeGreaterThan(60_000);
    expect(bomb.byteLength).toBeLessThanOrEqual(65_536);
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const spy = installEagerInflater();
      expect(await gunzipCapped(bomb, MAX)).toEqual({ ok: false, reason: 'too_large' });
      expect(spy.accepted()).toBeLessThanOrEqual(8 * 1024);
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }, 20_000);
  it('security review: the same bomb when each slice\'s output shows a few promise turns after its write is taken: still at most two slices', async () => {
    const bomb = gzipSync(new Uint8Array(64 * 1024 * 1024), { level: 9 });
    const spy = installEagerInflater(10);
    expect(await gunzipCapped(bomb, MAX)).toEqual({ ok: false, reason: 'too_large' });
    expect(spy.accepted()).toBeLessThanOrEqual(8 * 1024);
  }, 20_000);
  it('security review: the same bomb when each slice\'s output shows only on a later event-loop turn (a timer): still at most two slices accepted', async () => {
    const bomb = gzipSync(new Uint8Array(64 * 1024 * 1024), { level: 9 });
    const spy = installEagerInflater(0, true);
    expect(await gunzipCapped(bomb, MAX)).toEqual({ ok: false, reason: 'too_large' });
    expect(spy.accepted()).toBeLessThanOrEqual(8 * 1024);
  }, 20_000);
  it('slicing changes nothing for honest input: the same bytes come back from the eager inflater, and the whole body is accepted', async () => {
    const src = new Uint8Array(60_000);
    let x = 0x9e3779b9;
    for (let i = 0; i < src.length; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; src[i] = x & 255; }
    const gz = gzipSync(src);
    expect(gz.byteLength).toBeGreaterThan(4096 * 3);
    const spy = installEagerInflater();
    let turns = 0;
    const r = await gunzipCapped(gz, MAX, async () => { turns++; });
    expect(r.ok && Buffer.compare(Buffer.from(r.bytes), Buffer.from(src))).toBe(0);
    expect(spy.accepted()).toBe(gz.byteLength);
    // One yielded turn per 4 KiB slice.
    expect(turns).toBe(Math.ceil(gz.byteLength / 4096));
  }, 20_000);
  it('a second gzip member, or bytes after the member, are bad_gzip however the runtime treats them (security review)', async () => {
    const a = Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) & 0xff);
    const b = Uint8Array.from({ length: 2000 }, (_, i) => (i * 11 + 3) & 0xff);
    expect((await gunzipCapped(gzipSync(a), MAX)).ok).toBe(true);
    const two = new Uint8Array(Buffer.concat([gzipSync(a), gzipSync(b)]));
    expect(await gunzipCapped(two, MAX)).toEqual({ ok: false, reason: 'bad_gzip' });
    const tail = new Uint8Array(Buffer.concat([gzipSync(a), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]));
    expect(await gunzipCapped(tail, MAX)).toEqual({ ok: false, reason: 'bad_gzip' });
    // An empty second member adds no output and is refused all the same.
    const empty = new Uint8Array(Buffer.concat([gzipSync(a), gzipSync(new Uint8Array(0))]));
    expect(await gunzipCapped(empty, MAX)).toEqual({ ok: false, reason: 'bad_gzip' });
  });
  it('known pass: an empty LEADING member is not caught by the length check, and the inflated bytes are those of the member after it', async () => {
    // The check is a heuristic (see gunzipCapped). This pins what it does not catch, so a change to it is a decision.
    // Harmless: the inflated bytes, and so their SHA, equal the single-member upload's.
    const a = Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) & 0xff);
    const lead = new Uint8Array(Buffer.concat([gzipSync(new Uint8Array(0)), gzipSync(a)]));
    const r = await gunzipCapped(lead, MAX);
    expect(r.ok && Buffer.compare(Buffer.from(r.bytes), Buffer.from(a))).toBe(0);
  });
  it('truncated gzip, garbage and an empty body are bad_gzip', async () => {
    const whole = gzipSync(Uint8Array.from({ length: 4000 }, (_, i) => (i * 7) & 0xff));
    expect(await gunzipCapped(whole.subarray(0, whole.byteLength - 12), MAX)).toEqual({ ok: false, reason: 'bad_gzip' });
    expect(await gunzipCapped(Uint8Array.from({ length: 64 }, (_, i) => (i * 13 + 5) & 0xff), MAX)).toEqual({ ok: false, reason: 'bad_gzip' });
    expect(await gunzipCapped(new Uint8Array(0), MAX)).toEqual({ ok: false, reason: 'bad_gzip' });
  });
  it('a valid gzip of nothing is bad_gzip', async () => {
    expect(await gunzipCapped(gzipSync(new Uint8Array(0)), MAX)).toEqual({ ok: false, reason: 'bad_gzip' });
  });
});

describe('sha256Hex', () => {
  it('matches the FIPS 180-2 vector for "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('hashes empty input to the known SHA-256 of nothing', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
