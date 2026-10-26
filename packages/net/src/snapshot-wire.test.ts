import { describe, it, expect, afterEach } from 'vitest';
import { gzipSync } from 'node:zlib';
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
