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

/** Where the two strings begin: after the 44-byte fixed header (the matchDigest
 *  word and the 34 bytes that follow it), `build` then `matchId`, each a u16
 *  length and UTF-8. Pinned against the real encoder in `snapshot-wire.test.ts`,
 *  as the frameTick offset is. */
export const SNAPSHOT_META_OFFSET = SNAPSHOT_MATCH_DIGEST_OFFSET + 34;

/** The longest `build` or `matchId` a reader will accept. */
const META_STRING_MAX_BYTES = 256;

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

/** The identity words of a snapshot (named apart from `@lions/sim`'s `SnapshotMeta`, which has five fields). */
export interface SnapshotIdentity {
  build: string;
  matchId: string;
  contentDigest: number;
}

/** The identity words a client checks BEFORE it restores anything: `build`,
 *  `matchId` and `contentDigest`, read without decoding the snapshot (a restore
 *  can leave its target half-written, so these are checked first). Null for
 *  bytes too short, without the magic, with a string length past 256 bytes or
 *  past the end, or with invalid UTF-8. */
export function readSnapshotMeta(raw: Uint8Array): SnapshotIdentity | null {
  if (readSnapshotHeader(raw) === null) return null;
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const contentDigest = v.getUint32(SNAPSHOT_MATCH_DIGEST_OFFSET + 4, true);
  // ignoreBOM: true, like the sim's own reader (snapshot.ts): a leading U+FEFF stays in
  // the string, so a matchId is compared byte for byte with what the sim will read.
  const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let at = SNAPSHOT_META_OFFSET;
  const strings: string[] = [];
  for (let i = 0; i < 2; i++) {
    if (at + 2 > raw.byteLength) return null;
    const n = v.getUint16(at, true);
    at += 2;
    if (n > META_STRING_MAX_BYTES || at + n > raw.byteLength) return null;
    try { strings.push(dec.decode(raw.subarray(at, at + n))); } catch { return null; }
    at += n;
  }
  return { build: strings[0] ?? '', matchId: strings[1] ?? '', contentDigest };
}

export type GunzipResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' | 'bad_gzip' };

/** The most compressed bytes handed to the decompressor at once. */
const GUNZIP_SLICE_BYTES = 4096;
/** Promise turns with nothing to read before a drain is over. A queued chunk is read in about three. */
const DRAIN_IDLE_TURNS = 16;
/** One real event-loop turn: what separates one slice from the next by default. */
const eventLoopTurn = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

/** Inflate `gz`, refusing any output over `max` bytes. The output is counted
 *  chunk by chunk BEFORE a chunk is kept; past `max` the reader is cancelled
 *  and nothing is concatenated. A stream error, or an empty output, is
 *  `bad_gzip`.
 *
 *  The input is fed in slices of at most `GUNZIP_SLICE_BYTES`. After each
 *  slice is taken the call waits one event-loop turn (`yieldTurn`) and drains
 *  what is ready, so a decompressor that inflates eagerly, in the same turn or
 *  a later one, has produced at most one slice's output when the cap trips, and
 *  no further slice is written. `yieldTurn` is for tests that run on fake
 *  timers; the default is a zero-delay timer. Tested against fakes that inflate
 *  on every write, at once and on a later turn. */
export async function gunzipCapped(gz: Uint8Array, max: number, yieldTurn: () => Promise<void> = eventLoopTurn): Promise<GunzipResult> {
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
  // Reads until `stop` settles or the stream ends. Returns false once the cap has tripped.
  const readUntil = async (stop: Promise<typeof IDLE | typeof WROTE>): Promise<boolean> => {
    for (;;) {
      const x = await Promise.race([nextRead(), stop]);
      if (x === IDLE || x === WROTE || x.done) return true;
      if (!keep(x)) return false;
    }
  };
  try {
    for (let at = 0; at < gz.byteLength; at += GUNZIP_SLICE_BYTES) {
      // Not awaited alone: a write may wait on the reader. A failure surfaces as the reader's error.
      const wrote: Promise<typeof WROTE> = writer.write(gz.subarray(at, at + GUNZIP_SLICE_BYTES) as BufferSource).then(() => WROTE, () => WROTE);
      // Until the write is taken, then one event-loop turn, then whatever is ready: a few promise turns pass with nothing to read.
      if (!await readUntil(wrote)) return await refuse();
      if (!await readUntil(yieldTurn().then(() => IDLE))) return await refuse();
      if (!await readUntil(idleTurns())) return await refuse();
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
  // A heuristic that rejects most multi-member or trailing input: the last four bytes of a member are its inflated
  // length, so a later member or trailing bytes rarely match the whole output. An empty leading member is not caught;
  // that is harmless, since the inflated bytes, and so their SHA, are the same as without it.
  const tail = new DataView(gz.buffer, gz.byteOffset, gz.byteLength);
  if (gz.byteLength < 18 || tail.getUint32(gz.byteLength - 4, true) !== total) return { ok: false, reason: 'bad_gzip' };
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

/** Gzip `raw` at the default level (what the size headroom test measures). The
 *  Web `CompressionStream`, so the same in a browser and in Node. */
export async function gzipBytes(raw: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(raw as BufferSource).then(() => writer.close()).catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = cs.readable.getReader();
  for (;;) {
    const x = await reader.read();
    if (x.done) break;
    chunks.push(x.value);
    total += x.value.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}
