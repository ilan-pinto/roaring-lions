import { SNAPSHOT_MATCH_DIGEST_OFFSET } from '@lions/sim';

/** The snapshot format this build writes, re-exported so the Worker (which has
 *  no `@lions/sim` dependency) can name it through `@lions/net`. */
export { SNAPSHOT_FORMAT } from '@lions/sim';

/** Compressed upload cap, 64 KiB. Measured (snapshot spec §12.3): the worst
 *  sim-only snapshot, a 1,000-unit stress world, is 16.1 KiB gzipped; with the
 *  mission runtime it is about 18 KiB by addition (§13.3). The cap is four
 *  times the first and about 3.5 times the second -- never 16 KiB, which the
 *  stress world already fills. `tools/src/net/snapshot-size.test.ts` holds the
 *  measured size to half of this cap at the browser's default gzip level. */
export const SNAPSHOT_MAX_COMPRESSED_BYTES = 64 * 1024;

/** Inflated ceiling, 1 MiB: a bound on what a decompress may allocate, far
 *  above the largest measured snapshot (§12.3) and far below memory that
 *  matters. */
export const SNAPSHOT_MAX_RAW_BYTES = 1024 * 1024;

/** Where the header's `frameTick` word sits: after `matchDigest` and the
 *  4-byte `contentDigest` that follows it. Pinned against the real encoder in
 *  `snapshot-wire.test.ts`, so the sim needs no new export. */
export const SNAPSHOT_FRAME_TICK_OFFSET = SNAPSHOT_MATCH_DIGEST_OFFSET + 8;

/** The magic of a snapshot, 'RLSS'. */
const MAGIC = [0x52, 0x4c, 0x53, 0x53] as const;
/** The `format` word sits right after the magic. */
const FORMAT_OFFSET = 4;

export interface SnapshotHeader {
  format: number;
  matchDigest: number;
  frameTick: number;
}

/** The header words a relay may read without decoding the snapshot: `format`,
 *  `matchDigest` and `frameTick`, each little-endian and unsigned. Null for
 *  bytes too short to hold them or without the magic. Nothing past the
 *  `frameTick` word is read. */
export function readSnapshotHeader(raw: Uint8Array): SnapshotHeader | null {
  if (raw.byteLength < SNAPSHOT_FRAME_TICK_OFFSET + 4) return null;
  for (let i = 0; i < MAGIC.length; i++) if (raw[i] !== MAGIC[i]) return null;
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return {
    format: v.getUint16(FORMAT_OFFSET, true),
    matchDigest: v.getUint32(SNAPSHOT_MATCH_DIGEST_OFFSET, true),
    frameTick: v.getUint32(SNAPSHOT_FRAME_TICK_OFFSET, true),
  };
}

export type GunzipResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' | 'bad_gzip' };

/** The most compressed bytes handed to the decompressor at once. */
const GUNZIP_SLICE_BYTES = 4096;
/** Promise turns with nothing to read before the drain after a slice is over. A queued chunk is read in about three. */
const DRAIN_IDLE_TURNS = 16;

/** Inflate `gz`, refusing any output over `max` bytes. The output is counted
 *  chunk by chunk BEFORE a chunk is kept; past `max` the reader is cancelled
 *  and nothing is concatenated. A stream error, or an empty output, is
 *  `bad_gzip`.
 *
 *  The input is fed in slices of at most `GUNZIP_SLICE_BYTES`, and the reader
 *  is drained after each, so a runtime whose decompressor inflates eagerly
 *  (ignoring backpressure) has produced at most one slice's output when the cap
 *  trips, and no further slice is written. Tested against a fake that inflates
 *  on every write (security review). */
export async function gunzipCapped(gz: Uint8Array, max: number): Promise<GunzipResult> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  type Read = ReadableStreamReadResult<Uint8Array>;
  let inFlight: Promise<Read> | null = null;
  const nextRead = (): Promise<Read> => (inFlight ??= reader.read());
  // Takes one chunk off a finished read; false once the cap has tripped.
  const keep = (x: Read): boolean => {
    inFlight = null;
    if (x.done) return true;
    total += x.value.byteLength;
    if (total > max) return false;
    chunks.push(x.value);
    return true;
  };
  const refuse = async (): Promise<GunzipResult> => {
    await reader.cancel().catch(() => undefined);
    await writer.abort().catch(() => undefined);
    return { ok: false, reason: 'too_large' };
  };
  const IDLE: unique symbol = Symbol('idle');
  const WROTE: unique symbol = Symbol('wrote');
  const idleTurns = async (): Promise<typeof IDLE> => {
    for (let i = 0; i < DRAIN_IDLE_TURNS; i++) await undefined;
    return IDLE;
  };
  try {
    for (let at = 0; at < gz.byteLength; at += GUNZIP_SLICE_BYTES) {
      // Not awaited alone: a write may wait on the reader. A failure surfaces as the reader's error.
      const wrote: Promise<typeof WROTE> = writer.write(gz.subarray(at, at + GUNZIP_SLICE_BYTES) as BufferSource).then(() => WROTE, () => WROTE);
      // Until the write is taken, then until a read would have to wait: a few promise turns pass with nothing to read.
      // Promise turns, not a timer, so the drain runs under a test's fake timers as it does in the Worker.
      for (let accepted = false; ;) {
        const wait: Promise<typeof IDLE | typeof WROTE> = accepted ? idleTurns() : wrote;
        const x = await Promise.race([nextRead(), wait]);
        if (x === WROTE) { accepted = true; continue; }
        if (x === IDLE) break;
        if (x.done) break;
        if (!keep(x)) return await refuse();
      }
    }
    void writer.close().catch(() => undefined);
    for (;;) {
      const x = await nextRead();
      if (x.done) break;
      if (!keep(x)) return await refuse();
    }
  } catch {
    return { ok: false, reason: 'bad_gzip' };
  }
  if (total === 0) return { ok: false, reason: 'bad_gzip' };
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return { ok: true, bytes };
}

/** SHA-256 of `bytes` as 64 lowercase hex characters (Web Crypto, so the same
 *  in a browser, in Node and in the Worker). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}
