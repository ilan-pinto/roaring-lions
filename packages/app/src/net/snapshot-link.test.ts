import { afterEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_META_OFFSET, gzipBytes, sha256Hex } from '@lions/net';
import { Sim, encodeSim } from '@lions/sim';
import { FALLBACK_REASONS, prepareRejoin, snapshotLink, verifyFetched, type Fetched, type SnapshotLinkDeps } from './snapshot-link';

// Literals throughout: the oracle never imports its numbers from the code under test.
const CODE = 'ABCDEF';
const TICKET = 'tkt.SECRET-seat-ticket';
const CTX = { code: CODE, build: 'b-1', contentDigest: 0xcafebabe };

interface Scenario {
  meta?: { build?: string; matchId?: string; contentDigest?: number; frameTick?: number; matchDigest?: number };
  /** Applied to the raw bytes AFTER encoding, before the SHA is taken (so the SHA stays honest). */
  edit?: (raw: Uint8Array) => void;
  /** Applied after the SHA is taken: the SHA no longer matches. */
  flipAfterSha?: (raw: Uint8Array) => void;
  headers?: Record<string, string | null>;
  status?: number;
  /** Replaces the gzip body entirely. */
  body?: Uint8Array | ReadableStream<Uint8Array>;
}

async function respond(s: Scenario = {}): Promise<Response> {
  const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
  const raw = encodeSim(sim, { build: 'b-1', matchId: CODE, contentDigest: 0xcafebabe, frameTick: 1199, matchDigest: 0xdeadbeef, ...s.meta });
  s.edit?.(raw);
  const sha = await sha256Hex(raw);
  s.flipAfterSha?.(raw);
  const gz = await gzipBytes(raw);
  const h: Record<string, string | null> = {
    'x-snapshot-tick': '1199', 'x-snapshot-sha': sha, 'x-snapshot-digest': '3735928559', 'content-type': 'application/octet-stream', ...s.headers,
  };
  const headers = new Headers();
  for (const [k, v] of Object.entries(h)) if (v !== null) headers.set(k, v);
  const status = s.status ?? 200;
  if (status === 204) return new Response(null, { status, headers });
  return new Response((s.body ?? gz) as BodyInit, { status, headers });
}

interface Seen { url: string; init: RequestInit }
function fakeFetch(answer: (n: number) => Promise<Response> | Response) {
  const seen: Seen[] = [];
  const f = ((url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(answer(seen.length));
  }) as unknown as typeof fetch;
  return { f, seen };
}
const deps = (f: typeof fetch, over: Partial<SnapshotLinkDeps> = {}): SnapshotLinkDeps => ({ fetch: f, origin: 'https://game.example', code: CODE, ticket: TICKET, yieldTurn: () => Promise.resolve(), ...over });
const rejoin = async (s: Scenario, over: Partial<SnapshotLinkDeps> = {}) => {
  const { f } = fakeFetch(() => respond(s));
  return prepareRejoin(snapshotLink(deps(f, over)), CTX);
};
const ofSet = (at: number, v: number) => (raw: Uint8Array): void => { raw[at] = v; };

afterEach(() => { vi.useRealTimers(); });

describe('prepareRejoin: a tick whose next frame cannot be asked for', () => {
  // Literals: 0x7fffffff is 2,147,483,647 and `from` may reach it, so the last askable snapshot is 0x7ffffffe.
  const at = (tick: number) => rejoin({ meta: { frameTick: tick }, headers: { 'x-snapshot-tick': String(tick) } });
  it('frameTick 2,147,483,647 would need from 2,147,483,648: bad_header, a full replay', async () => {
    expect(await at(2147483647)).toEqual({ path: 'full', reason: 'bad_header' });
  });
  it('frameTick 2,147,483,646 is the last one that can be asked for', async () => {
    const r = await at(2147483646);
    expect(r.path).toBe('snapshot');
    if (r.path === 'snapshot') expect(r.verified.frameTick).toBe(2147483646);
  });
});

describe('prepareRejoin: the success path', () => {
  it('a good snapshot is path: snapshot with the header tick and digest', async () => {
    const r = await rejoin({});
    expect(r.path).toBe('snapshot');
    if (r.path !== 'snapshot') return;
    expect(r.verified.frameTick).toBe(1199);
    expect(r.verified.matchDigest).toBe(3735928559);
    expect(r.verified.raw.byteLength).toBeGreaterThan(44);
  });
  it('the request: GET, the ticket in Authorization only, never in the URL, no-store', async () => {
    const { f, seen } = fakeFetch(() => respond({}));
    await prepareRejoin(snapshotLink(deps(f)), CTX);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://game.example/api/match/ABCDEF/snapshot');
    expect(seen[0]?.url).not.toContain('SECRET');
    expect(seen[0]?.init.method).toBe('GET');
    expect(seen[0]?.init.cache).toBe('no-store');
    expect(seen[0]?.init.headers).toEqual({ authorization: `Bearer ${TICKET}` });
  });
});

/** One case per PRE reason, each built from the success by one change. */
const PRE_CASES: Record<string, () => Promise<string>> = {
  fetch_failed: async () => {
    const sync = ((): never => { throw new TypeError('no socket'); }) as unknown as typeof fetch;
    const rejected = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    const a = await prepareRejoin(snapshotLink(deps(sync)), CTX);
    const b = await prepareRejoin(snapshotLink(deps(rejected)), CTX);
    expect([a, b]).toEqual([{ path: 'full', reason: 'fetch_failed' }, { path: 'full', reason: 'fetch_failed' }]);
    return 'fetch_failed';
  },
  timeout: async () => {
    vi.useFakeTimers();
    const never = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const p = prepareRejoin(snapshotLink(deps(never)), CTX);
    await vi.advanceTimersByTimeAsync(4999);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ path: 'full', reason: 'timeout' });
    return 'timeout';
  },
  http_status: async () => {
    expect(await rejoin({ status: 403 })).toEqual({ path: 'full', reason: 'http_status' });
    expect(await rejoin({ status: 500 })).toEqual({ path: 'full', reason: 'http_status' });
    return 'http_status';
  },
  none: async () => {
    expect(await rejoin({ status: 204 })).toEqual({ path: 'full', reason: 'none' });
    return 'none';
  },
  bad_headers: async () => {
    const bad: Record<string, string | null>[] = [
      { 'x-snapshot-tick': null }, { 'x-snapshot-sha': null }, { 'x-snapshot-digest': null },
      { 'x-snapshot-sha': 'a'.repeat(63) }, { 'x-snapshot-sha': 'A'.repeat(64) },
      { 'x-snapshot-tick': '1199abc' }, { 'x-snapshot-tick': '+1199' }, { 'x-snapshot-tick': '4294967296' }, { 'x-snapshot-tick': '1e3' },
      { 'x-snapshot-digest': '0x10' }, { 'x-snapshot-digest': '12 3' },
    ];
    for (const headers of bad) expect(await rejoin({ headers }), JSON.stringify(headers)).toEqual({ path: 'full', reason: 'bad_headers' });
    return 'bad_headers';
  },
  too_large: async () => {
    // Declared: refused with NO read of the body.
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(10)); } }, { highWaterMark: 0 });
    expect(await rejoin({ headers: { 'content-length': '65537' }, body })).toEqual({ path: 'full', reason: 'too_large' });
    expect(pulled).toBe(0);
    // Undeclared (or a lie): a stream of 65,537 bytes is refused by the read cap.
    expect(await rejoin({ body: new Uint8Array(65537) })).toEqual({ path: 'full', reason: 'too_large' });
    // 65,536 is within the cap: it gets as far as the gzip, which it is not.
    expect(await rejoin({ body: new Uint8Array(65536) })).toEqual({ path: 'full', reason: 'bad_gzip' });
    return 'too_large';
  },
  bad_gzip: async () => {
    expect(await rejoin({ body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) })).toEqual({ path: 'full', reason: 'bad_gzip' });
    return 'bad_gzip';
  },
  sha_mismatch: async () => {
    // One bit flipped in the BODY of the snapshot after the SHA was taken: header and meta still read true.
    expect(await rejoin({ flipAfterSha: (raw) => { raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1; } })).toEqual({ path: 'full', reason: 'sha_mismatch' });
    return 'sha_mismatch';
  },
  bad_header: async () => {
    expect(await rejoin({ edit: ofSet(0, 0x58) })).toEqual({ path: 'full', reason: 'bad_header' });   // wrong magic
    // The strings: a build length of 300 is past the 256 limit.
    expect(await rejoin({ edit: (raw) => { new DataView(raw.buffer, raw.byteOffset).setUint16(SNAPSHOT_META_OFFSET, 300, true); } })).toEqual({ path: 'full', reason: 'bad_header' });
    return 'bad_header';
  },
  format: async () => {
    expect(await rejoin({ edit: ofSet(4, 2) })).toEqual({ path: 'full', reason: 'format' });
    return 'format';
  },
  tick_mismatch: async () => {
    expect(await rejoin({ meta: { frameTick: 1198 } })).toEqual({ path: 'full', reason: 'tick_mismatch' });
    return 'tick_mismatch';
  },
  digest_mismatch: async () => {
    expect(await rejoin({ headers: { 'x-snapshot-digest': '3735928560' } })).toEqual({ path: 'full', reason: 'digest_mismatch' });
    return 'digest_mismatch';
  },
  build_mismatch: async () => {
    expect(await rejoin({ meta: { build: 'b-2' } })).toEqual({ path: 'full', reason: 'build_mismatch' });
    return 'build_mismatch';
  },
  content_mismatch: async () => {
    expect(await rejoin({ meta: { contentDigest: 0xcafebabf } })).toEqual({ path: 'full', reason: 'content_mismatch' });
    return 'content_mismatch';
  },
  match_mismatch: async () => {
    expect(await rejoin({ meta: { matchId: 'ZZZZZZ' } })).toEqual({ path: 'full', reason: 'match_mismatch' });
    return 'match_mismatch';
  },
};

describe('prepareRejoin: one case per pre-hello fallback reason', () => {
  for (const [reason, run] of Object.entries(PRE_CASES)) {
    it(reason, async () => { expect(await run()).toBe(reason); });
  }
  it('the cases are exactly the pre reasons of the table (a reason with no case, or a case with no reason, is red)', () => {
    const pre = Object.entries(FALLBACK_REASONS).filter(([, w]) => w === 'pre').map(([k]) => k).sort();
    expect(pre).toEqual([
      'bad_gzip', 'bad_header', 'bad_headers', 'build_mismatch', 'content_mismatch', 'digest_mismatch', 'fetch_failed', 'format', 'http_status',
      'match_mismatch', 'none', 'sha_mismatch', 'tick_mismatch', 'timeout', 'too_large',
    ]);
    expect(Object.keys(PRE_CASES).sort()).toEqual(pre);
  });
  it('the post reasons are the eight the contract names', () => {
    expect(Object.entries(FALLBACK_REASONS).filter(([, w]) => w === 'post').map(([k]) => k).sort()).toEqual([
      'build_failed', 'cadence_off', 'config_match_mismatch', 'digest_after_restore', 'not_snapshot_tick', 'not_versus', 'refused', 'restore_threw',
    ]);
  });
  it('prepareRejoin never throws: a link whose latest() throws is fetch_failed', async () => {
    const link = { latest: (): never => { throw new Error('boom'); } };
    expect(await prepareRejoin(link, CTX)).toEqual({ path: 'full', reason: 'fetch_failed' });
    const lies = { latest: () => Promise.reject(new Error('boom')) };
    expect(await prepareRejoin(lies, CTX)).toEqual({ path: 'full', reason: 'fetch_failed' });
  });
});

describe('verifyFetched', () => {
  it('a NEGATIVE caller digest (shippedContentDigest() is a signed int32) matches the snapshot\'s unsigned word (S4 review F1)', async () => {
    const { f } = fakeFetch(() => respond({ meta: { contentDigest: 4050403620 } }));
    expect(await prepareRejoin(snapshotLink(deps(f)), { ...CTX, contentDigest: -244563676 })).toMatchObject({ path: 'snapshot' });
    // and a different word is still refused, so the check is not vacuous
    expect(await prepareRejoin(snapshotLink(deps(f)), { ...CTX, contentDigest: -244563677 })).toEqual({ path: 'full', reason: 'content_mismatch' });
  });
  it('runs the SHA before the header: a flipped body with a wrong magic is sha_mismatch, not bad_header', async () => {
    const raw = new Uint8Array(64);
    const f: Fetched = { tick: 0, sha: '0'.repeat(64), digest: 0, raw };
    expect(await verifyFetched(f, CTX)).toEqual({ ok: false, reason: 'sha_mismatch' });
  });
});

describe('snapshotLink.upload', () => {
  const gz = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
  const outcome = async (status: number) => {
    const { f } = fakeFetch(() => new Response(null, { status }));
    return snapshotLink(deps(f)).upload(1199, gz);
  };
  it('201 stored, 202 held, anything else refused', async () => {
    expect(await outcome(201)).toBe('stored');
    expect(await outcome(202)).toBe('held');
    for (const s of [400, 401, 403, 413, 429, 500]) expect(await outcome(s), String(s)).toBe('refused');
  });
  it('a 409 is read by the room\'s body: duplicate is recorded, mismatch is its own outcome, stale / not_running / unreadable are refused (S4 review F2)', async () => {
    const by = async (body: string | null) => {
      const { f } = fakeFetch(() => new Response(body, { status: 409 }));
      return snapshotLink(deps(f)).upload(1199, gz);
    };
    expect(await by('duplicate')).toBe('duplicate');
    expect(await by('mismatch')).toBe('mismatch');
    expect(await by('stale')).toBe('refused');
    expect(await by('not_running')).toBe('refused');
    expect(await by(null)).toBe('refused');
    expect(await by('something else')).toBe('refused');
    expect(await by('x'.repeat(65))).toBe('refused');
  });
  it('a network error is failed, and the request is not repeated', async () => {
    let n = 0;
    const f = (() => { n++; return Promise.reject(new TypeError('Failed to fetch')); }) as unknown as typeof fetch;
    expect(await snapshotLink(deps(f)).upload(1199, gz)).toBe('failed');
    expect(n).toBe(1);
  });
  it('the request: POST, ticket in Authorization only, the tick, octet-stream, the bytes as given', async () => {
    const { f, seen } = fakeFetch(() => new Response(null, { status: 201 }));
    await snapshotLink(deps(f)).upload(2399, gz);
    expect(seen[0]?.url).toBe('https://game.example/api/match/ABCDEF/snapshot');
    expect(seen[0]?.init.method).toBe('POST');
    expect(seen[0]?.init.headers).toEqual({ authorization: `Bearer ${TICKET}`, 'x-snapshot-tick': '2399', 'content-type': 'application/octet-stream' });
    expect(seen[0]?.init.body).toBe(gz);
  });
  it('a request that never answers is failed after ten seconds, not before', async () => {
    vi.useFakeTimers();
    const never = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const p = snapshotLink(deps(never)).upload(1199, gz);
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(9999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe('failed');
  });
  it('the timeout ABORTS the request, not only the wait: the signal is aborted at ten seconds and not before (S4 review F3)', async () => {
    vi.useFakeTimers();
    let sig: AbortSignal | undefined;
    const never = ((_u: string, init: RequestInit) => { sig = init.signal ?? undefined; return new Promise<Response>(() => undefined); }) as unknown as typeof fetch;
    const p = snapshotLink(deps(never)).upload(1199, gz);
    await vi.advanceTimersByTimeAsync(9999);
    expect(sig?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(sig?.aborted).toBe(true);
    expect(await p).toBe('failed');
  });
  it('a 409 whose body never arrives ends at ten seconds with the signal aborted', async () => {
    vi.useFakeTimers();
    let sig: AbortSignal | undefined;
    const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) });
    const f = ((_u: string, init: RequestInit) => { sig = init.signal ?? undefined; return Promise.resolve(new Response(stalled, { status: 409 })); }) as unknown as typeof fetch;
    const p = snapshotLink(deps(f)).upload(1199, gz);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sig?.aborted).toBe(true);
    expect(await p).toBe('failed');
  });
  it('the caller\'s abort ends a request in flight', async () => {
    const ctl = new AbortController();
    const f = ((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
      const stop = (): void => rej(new DOMException('aborted', 'AbortError'));
      if (init.signal?.aborted === true) stop(); else init.signal?.addEventListener('abort', stop);
    })) as unknown as typeof fetch;
    const p = snapshotLink(deps(f, { signal: ctl.signal })).upload(1199, gz);
    ctl.abort();
    expect(await p).toBe('failed');
    const g = snapshotLink(deps(f, { signal: ctl.signal })).latest();
    expect(await g).toEqual({ fallback: 'fetch_failed' });
  });
});

describe('snapshotLink.latest: the five-second timeout aborts the request (S4 review F3)', () => {
  it('headers never arrive: the signal is aborted at five seconds and not before', async () => {
    vi.useFakeTimers();
    let sig: AbortSignal | undefined;
    const never = ((_u: string, init: RequestInit) => { sig = init.signal ?? undefined; return new Promise<Response>(() => undefined); }) as unknown as typeof fetch;
    const p = snapshotLink(deps(never)).latest();
    await vi.advanceTimersByTimeAsync(4999);
    expect(sig?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(sig?.aborted).toBe(true);
    expect(await p).toEqual({ fallback: 'timeout' });
  });
  it('headers arrive and the body stalls: timeout at five seconds, signal aborted', async () => {
    vi.useFakeTimers();
    let sig: AbortSignal | undefined;
    let pulls = 0;
    const stalled = new ReadableStream<Uint8Array>({ pull: () => { pulls++; return new Promise<void>(() => undefined); } });
    const headers = { 'x-snapshot-tick': '1199', 'x-snapshot-sha': 'a'.repeat(64), 'x-snapshot-digest': '3735928559' };
    const f = ((_u: string, init: RequestInit) => { sig = init.signal ?? undefined; return Promise.resolve(new Response(stalled, { status: 200, headers })); }) as unknown as typeof fetch;
    const p = snapshotLink(deps(f)).latest();
    await vi.advanceTimersByTimeAsync(4999);
    expect(pulls).toBeGreaterThan(0);
    expect(sig?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(sig?.aborted).toBe(true);
    expect(await p).toEqual({ fallback: 'timeout' });
  });
});
