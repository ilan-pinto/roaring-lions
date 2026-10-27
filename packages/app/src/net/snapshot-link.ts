/**
 * The HTTP half of the snapshot client (snapshot spec §3.3, S4 task 5): the
 * upload a producer makes, the one GET a reload makes, and every check that can
 * be made BEFORE the `hello` -- the SHA, the header, the build, the content
 * digest and the match id. The checks that need the room's config come after
 * the `log` (`snapshot-rejoin.ts`, Task 7).
 *
 * No DOM, so the AI harness and the tests run the code the browser runs. The
 * seat ticket goes into the `Authorization` header and nowhere else: never a
 * URL, never a log line (this module logs nothing).
 *
 * Nothing here throws on a bad network or a bad snapshot: every failure is a
 * reason from `FALLBACK_REASONS`, and a reload that gets one is today's reload
 * (G-2: the frame log stays the authority).
 */
import { SNAPSHOT_FORMAT, isFromTick, SNAPSHOT_MAX_COMPRESSED_BYTES, SNAPSHOT_MAX_RAW_BYTES, gunzipCapped, readSnapshotHeader, readSnapshotMeta, sha256Hex } from '@lions/net';
import type { UploadOutcome } from './snapshot-producer';

/** The reload's GET: the room is `gone`-stalled and the forfeit clock runs while it waits (plan Ruling 5). */
export const SNAPSHOT_FETCH_TIMEOUT_MS = 5000;
/** The producer's POST (plan Ruling 7). */
export const SNAPSHOT_UPLOAD_TIMEOUT_MS = 10_000;

/** Every reason a rejoin falls back to the full log, tagged by where it is found: `pre` before the `hello`, `post` after the `log`. */
export const FALLBACK_REASONS = {
  fetch_failed: 'pre',
  timeout: 'pre',
  http_status: 'pre',
  none: 'pre',
  bad_headers: 'pre',
  too_large: 'pre',
  bad_gzip: 'pre',
  sha_mismatch: 'pre',
  bad_header: 'pre',
  format: 'pre',
  tick_mismatch: 'pre',
  digest_mismatch: 'pre',
  build_mismatch: 'pre',
  content_mismatch: 'pre',
  match_mismatch: 'pre',
  not_versus: 'post',
  cadence_off: 'post',
  not_snapshot_tick: 'post',
  config_match_mismatch: 'post',
  build_failed: 'post',
  refused: 'post',
  digest_after_restore: 'post',
  restore_threw: 'post',
} as const;

export type FallbackReason = keyof typeof FALLBACK_REASONS;
export type PreReason = { [K in FallbackReason]: (typeof FALLBACK_REASONS)[K] extends 'pre' ? K : never }[FallbackReason];
export type PostReason = Exclude<FallbackReason, PreReason>;

/** What the GET brought, inflated and not yet trusted: the three headers as parsed, and the raw snapshot bytes. */
export interface Fetched {
  /** `X-Snapshot-Tick`. */
  tick: number;
  /** `X-Snapshot-Sha`: 64 lowercase hex. */
  sha: string;
  /** `X-Snapshot-Digest`, an unsigned decimal. */
  digest: number;
  raw: Uint8Array;
}

/** A snapshot that passed every check made before the `hello`. */
export interface Verified {
  raw: Uint8Array;
  frameTick: number;
  matchDigest: number;
}

export interface SnapshotLink {
  /** One POST, ten seconds at most. Never throws, never retries. */
  upload(tick: number, gz: Uint8Array): Promise<UploadOutcome>;
  /** One GET, five seconds at most. */
  latest(): Promise<Fetched | { fallback: PreReason }>;
}

export interface SnapshotLinkDeps {
  fetch: typeof fetch;
  origin: string;
  code: string;
  ticket: string;
  /** The page's own abort (a screen left): aborts the request in flight. */
  signal?: AbortSignal;
  /** Passed to `gunzipCapped`: tests on fake timers must supply one. */
  yieldTurn?: () => Promise<void>;
  /** Overrides, for tests that advance fake timers a different distance. */
  fetchTimeoutMs?: number;
  uploadTimeoutMs?: number;
}

const DECIMAL_U32 = /^(0|[1-9][0-9]{0,9})$/;
const SHA_HEX = /^[0-9a-f]{64}$/;
const U32_MAX = 0xffff_ffff;

/** A decimal u32 and nothing else (`Number()` would take '1e3', ' 7', '0x10'); null otherwise. */
function parseU32(v: string | null): number | null {
  if (v === null || !DECIMAL_U32.test(v)) return null;
  const n = Number(v);
  return n <= U32_MAX ? n : null;
}

class TimedOut extends Error {}

/** Runs `work` under a timeout and the caller's abort. The timer firing aborts the request AND rejects, so a `fetch`
 *  that ignores its signal still ends. Resolves the work's value, or rejects `TimedOut` / the work's own error. */
async function within<T>(ms: number, outer: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const onOuter = (): void => ctl.abort();
  if (outer?.aborted === true) ctl.abort();
  outer?.addEventListener('abort', onOuter, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ctl.abort(); reject(new TimedOut()); }, ms);
  });
  try {
    return await Promise.race([work(ctl.signal), clock]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

/** Reads a body as a stream, refusing past `max` bytes: the reader is cancelled the moment the total passes it. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const x = await reader.read();
    if (x.done) break;
    total += x.value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(x.value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

export function snapshotLink(deps: SnapshotLinkDeps): SnapshotLink {
  const url = `${deps.origin}/api/match/${encodeURIComponent(deps.code)}/snapshot`;
  const auth = { authorization: `Bearer ${deps.ticket}` };
  return {
    async upload(tick, gz) {
      try {
        const status = await within<{ status: number; reason: string }>(deps.uploadTimeoutMs ?? SNAPSHOT_UPLOAD_TIMEOUT_MS, deps.signal, async (signal) => {
          const res = await deps.fetch(url, {
            method: 'POST',
            headers: { ...auth, 'x-snapshot-tick': String(tick), 'content-type': 'application/octet-stream' },
            body: gz as BufferSource,
            cache: 'no-store',
            signal,
          });
          if (res.status !== 409) {
            await res.body?.cancel().catch(() => undefined);
            return { status: res.status, reason: '' };
          }
          // The room says why in a few bytes of text (`not_running`, `stale`, `duplicate`, `mismatch`); an unreadable one is "".
          const body = await readCapped(res, 64).catch(() => null);
          return { status: 409, reason: body === null ? '' : new TextDecoder().decode(body).trim() };
        });
        if (status.status === 201) return 'stored';
        if (status.status === 202) return 'held';
        // A 409 is ruled by the room's body (S4 review F2): only `duplicate` means "recorded already" (§14.4),
        // which arises on a lost-response retry. `mismatch` is a desync signal and keeps its own outcome;
        // `stale`, `not_running` and anything unreadable were NOT recorded and are refused.
        if (status.status === 409) return status.reason === 'duplicate' ? 'duplicate' : status.reason === 'mismatch' ? 'mismatch' : 'refused';
        return 'refused';
      } catch {
        return 'failed';
      }
    },

    async latest() {
      try {
        return await within(deps.fetchTimeoutMs ?? SNAPSHOT_FETCH_TIMEOUT_MS, deps.signal, (signal) => fetchLatest(deps, url, auth, signal));
      } catch (e) {
        return { fallback: e instanceof TimedOut ? 'timeout' : 'fetch_failed' };
      }
    },
  };
}

async function fetchLatest(
  deps: SnapshotLinkDeps,
  url: string,
  auth: { authorization: string },
  signal: AbortSignal,
): Promise<Fetched | { fallback: PreReason }> {
  const res = await deps.fetch(url, { method: 'GET', headers: auth, cache: 'no-store', signal });
  if (res.status === 204) {
    await res.body?.cancel().catch(() => undefined);
    return { fallback: 'none' };
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    return { fallback: 'http_status' };
  }
  const tick = parseU32(res.headers.get('x-snapshot-tick'));
  const digest = parseU32(res.headers.get('x-snapshot-digest'));
  const sha = res.headers.get('x-snapshot-sha');
  if (tick === null || digest === null || sha === null || !SHA_HEX.test(sha)) {
    await res.body?.cancel().catch(() => undefined);
    return { fallback: 'bad_headers' };
  }
  // A declared length over the cap is refused before a byte is read; the stream cap below is the real bound.
  const declared = res.headers.get('content-length');
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > SNAPSHOT_MAX_COMPRESSED_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    return { fallback: 'too_large' };
  }
  const gz = await readCapped(res, SNAPSHOT_MAX_COMPRESSED_BYTES);
  if (gz === null) return { fallback: 'too_large' };
  const inflated = await gunzipCapped(gz, SNAPSHOT_MAX_RAW_BYTES, deps.yieldTurn);
  if (!inflated.ok) return { fallback: inflated.reason };
  return { tick, sha, digest, raw: inflated.bytes };
}

export interface VerifyContext {
  /** The room code the client reloaded into (the room mints `matchId: code`). */
  code: string;
  /** This client's own build. */
  build: string;
  /** This client's own content digest (`shippedContentDigest()`). */
  contentDigest: number;
}

export type VerifyResult = { ok: true; verified: Verified } | { ok: false; reason: PreReason };

/** Contract steps 5 and 6: the SHA of the inflated bytes, then the header and the identity words, in that order. */
export async function verifyFetched(f: Fetched, ctx: VerifyContext): Promise<VerifyResult> {
  if ((await sha256Hex(f.raw)) !== f.sha) return { ok: false, reason: 'sha_mismatch' };
  const header = readSnapshotHeader(f.raw);
  if (header === null) return { ok: false, reason: 'bad_header' };
  if (header.format !== SNAPSHOT_FORMAT) return { ok: false, reason: 'format' };
  if (header.frameTick !== f.tick) return { ok: false, reason: 'tick_mismatch' };
  // The hello asks for the log from `frameTick + 1`, and the room and the transport carry only a `from` up to 0x7fffffff
  // (`isFromTick`). A tick past that could never be asked for, so refuse it here and replay the whole log (S4 review L2).
  if (!isFromTick(header.frameTick + 1)) return { ok: false, reason: 'bad_header' };
  if (header.matchDigest !== f.digest) return { ok: false, reason: 'digest_mismatch' };
  const meta = readSnapshotMeta(f.raw);
  if (meta === null) return { ok: false, reason: 'bad_header' };
  if (meta.build !== ctx.build) return { ok: false, reason: 'build_mismatch' };
  // `shippedContentDigest()` is a signed int32 (`fnv1a32` returns `h | 0`) and the snapshot meta is a u32 (S4 review F1).
  if (meta.contentDigest !== ctx.contentDigest >>> 0) return { ok: false, reason: 'content_mismatch' };
  if (meta.matchId !== ctx.code) return { ok: false, reason: 'match_mismatch' };
  return { ok: true, verified: { raw: f.raw, frameTick: header.frameTick, matchDigest: header.matchDigest } };
}

export type Prepared = { path: 'snapshot'; verified: Verified } | { path: 'full'; reason: PreReason };

/** Everything a reload can check before its `hello`. Never throws: any failure is `{ path: 'full', reason }`. */
export async function prepareRejoin(link: Pick<SnapshotLink, 'latest'>, ctx: VerifyContext): Promise<Prepared> {
  let got: Fetched | { fallback: PreReason };
  try {
    got = await link.latest();
  } catch {
    return { path: 'full', reason: 'fetch_failed' };
  }
  if ('fallback' in got) return { path: 'full', reason: got.fallback };
  try {
    const v = await verifyFetched(got, ctx);
    return v.ok ? { path: 'snapshot', verified: v.verified } : { path: 'full', reason: v.reason };
  } catch {
    // Web Crypto missing (an insecure context) or a fault of our own: nothing was verified, so nothing is trusted.
    return { path: 'full', reason: 'sha_mismatch' };
  }
}
