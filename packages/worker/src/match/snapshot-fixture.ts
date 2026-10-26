/**
 * Test helpers for the snapshot upload path. Not a test file (other specs
 * import it) and nothing the Worker ships imports it. The bytes are synthetic:
 * the real header words at the constants `@lions/net` pins against the real
 * encoder, followed by filler. The room never decodes a snapshot, so a header
 * and a filler are all it can tell from a real one.
 */
import { gzipSync } from 'node:zlib';
import { SNAPSHOT_FRAME_TICK_OFFSET } from '@lions/net';

// The worker package does not depend on @lions/sim, so the other two header
// facts are written here as literals: `format` 1, and `matchDigest` eight bytes
// before `frameTick` (`contentDigest` sits between). `@lions/net`'s
// snapshot-wire test pins FRAME_TICK_OFFSET against the real encoder.
const FORMAT = 1;
const MATCH_DIGEST_OFFSET = SNAPSHOT_FRAME_TICK_OFFSET - 8;

/** Bytes after the header words, enough that the frame-tick word is inside the header proper. */
const HEADER_BYTES = SNAPSHOT_FRAME_TICK_OFFSET + 4;

export interface FixtureOpts {
  frameTick: number;
  matchDigest: number;
  /** Filler byte value; varying it varies the SHA. */
  fill?: number;
  /** Filler length after the header words. */
  length?: number;
}

/** Synthetic INFLATED snapshot bytes: the magic, `format`, the two header words at their offsets, then filler. */
export function snapshotBytes(o: FixtureOpts): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + (o.length ?? 64));
  out.set([0x52, 0x4c, 0x53, 0x53], 0);
  const v = new DataView(out.buffer);
  v.setUint16(4, FORMAT, true);
  v.setUint32(MATCH_DIGEST_OFFSET, o.matchDigest >>> 0, true);
  v.setUint32(SNAPSHOT_FRAME_TICK_OFFSET, o.frameTick, true);
  out.fill(o.fill ?? 0, HEADER_BYTES);
  return out;
}

async function pump(bytes: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(bytes as BufferSource).then(() => w.close());
  const parts: Uint8Array[] = [];
  const r = stream.readable.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/** gzip, through the platform's `CompressionStream` (the compressor a browser uses). */
export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pump(bytes, new CompressionStream('gzip') as unknown as Parameters<typeof pump>[1]);
}

/** gzip of `n` zero bytes: a decompression bomb when `n` is large. */
export function bomb(n: number): Promise<Uint8Array> {
  return gzip(new Uint8Array(n));
}

let maxBomb: Uint8Array | null = null;
/** The largest bomb the 64 KiB compressed cap admits: 64 MiB of zeros at gzip level 9 is about 65,250 bytes. Built once (about 0.1 s). */
export function maxSizeBomb(): Uint8Array {
  maxBomb ??= gzipSync(new Uint8Array(64 * 1024 * 1024), { level: 9 });
  return maxBomb;
}
