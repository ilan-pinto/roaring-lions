/** A size bound on the `/api/match*` request bodies (hardening): create, join and the advisor
 *  ticket each read their body through one capped reader, and an oversize body is a 413 before
 *  anything is parsed or any room is asked. The cap is set from the largest LEGITIMATE body,
 *  measured here from the real tables, not from a number typed in. */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ADVISOR_SCOPES, MAX_CALLSIGN_CHARS, SNAPSHOT_MAX_COMPRESSED_BYTES } from '@lions/net';
import { handleMatch, MATCH_BODY_MAX_BYTES } from './routes';
import { signTicket } from './ticket';
import { KIT_TRACKS } from './kit-tracks';
import { SHIPPED_MAP_IDS } from './map-ids';
import { MAX_FIELD_CHARS, ROUND_TICKS_RANGE, ROUND_WALL_MS_RANGE } from './room-fields';
import type { Env, RateLimiter } from '../d1';

const NOW = 1_790_000_000_000;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';
const enc = new TextEncoder();
const bytes = (v: unknown): number => enc.encode(JSON.stringify(v)).length;

/** The cap's literal and the measurement it was set from (kept in step with routes.ts). */
const CAP_LITERAL = 3584;

/** Every KDF type's every track at its maximum tier, from the real table. */
function fullTiers(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, tracks] of Object.entries(KIT_TRACKS)) out[id] = { ...tracks };
  return out;
}

/** The three legitimate bodies at their longest, UTF-8 worst case on every free-text field. */
function legitimateBodies(): { create: object; join: object } {
  const wide = (n: number, ch: string): string => ch.repeat(n);
  const longestMap = [...SHIPPED_MAP_IDS].sort((a, b) => b.length - a.length)[0];
  const player = wide(MAX_FIELD_CHARS, '€');             // 3 bytes a unit; textField keeps 64 units
  const build = wide(MAX_FIELD_CHARS, '€');
  const callsign = wide(MAX_CALLSIGN_CHARS, '😀');        // 4 bytes a code point; survives NFKC
  const pace = { kind: 'paced', roundTicks: ROUND_TICKS_RANGE.max, roundWallMs: ROUND_WALL_MS_RANGE.max };
  const tiers = fullTiers();
  return {
    create: { player, callsign, map: longestMap, build, mode: 'versus', matchup: 'mirror', kind: 'human', pace, kit: 'brigade', tiers },
    join: { player, callsign, build, kind: 'human', tiers },
  };
}

/** A control or lone-surrogate unit in `player`/`build` would serialise as 6 bytes (\uXXXX), against the
 *  3 measured here; no real client sends those, and even then the maximum is about 2028 bytes, under cap / 1.5.
 *  The advisor body carries a seat ticket, b64url(payload).b64url(sig); its longest payload names a 64-unit player of 3-byte characters. */
async function measuredMax(): Promise<number> {
  const b = legitimateBodies();
  const ticket = await signTicket('secret', { matchId: 'ABCDEF', seat: 1, player: '€'.repeat(MAX_FIELD_CHARS), exp: NOW + 6 * 3600 * 1000 });
  return Math.max(bytes(b.create), bytes(b.join), bytes({ ticket, scope: ADVISOR_SCOPES[0] }));
}

function fakeRooms(): { env: Env; calls: string[]; created: Record<string, unknown>[]; forwarded: number[] } {
  const calls: string[] = [];
  /** The byte length of each body a room stub was sent at /snapshot. */
  const forwarded: number[] = [];
  const created: Record<string, unknown>[] = [];
  const rooms = new Set<string>();
  const stub = (name: string) => ({
    fetch: async (req: Request): Promise<Response> => {
      const path = new URL(req.url).pathname;
      calls.push(path);
      if (path === '/create') { created.push(await req.json() as Record<string, unknown>); rooms.add(name); return Response.json({ ok: true }); }
      if (path === '/snapshot') { forwarded.push((await req.arrayBuffer()).byteLength); return new Response('stored', { status: 201 }); }
      if (path === '/join') return rooms.has(name) ? Response.json({ seat: 1 }) : new Response('', { status: 404 });
      return new Response('', { status: 404 });
    },
  });
  const limiter: RateLimiter = { limit: async () => ({ success: true }) };
  const env = {
    DB: {} as Env['DB'], ASSETS: { fetch: async () => new Response('') },
    TICKET_SECRET: 'secret', ROOM_LIMIT: limiter, SNAP_LIMIT: limiter,
    ROOMS: { idFromName: (n: string) => n, get: (id: unknown) => stub(id as string) },
  } as unknown as Env;
  return { env, calls, created, forwarded };
}

const headers = (extra: Record<string, string> = {}): Record<string, string> =>
  ({ origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...extra });
const postRaw = (url: string, body: string, extra: Record<string, string> = {}): Request =>
  new Request(url, { method: 'POST', headers: headers(extra), body });

/** A JSON object of exactly `size` UTF-8 bytes: `base` plus an ASCII `pad` field. */
function padded(base: Record<string, unknown>, size: number): string {
  const out = JSON.stringify({ ...base, pad: 'x'.repeat(size - bytes({ ...base, pad: '' })) });
  expect(enc.encode(out).length).toBe(size);
  return out;
}

/** A body stream that counts what the reader pulled from it. */
function countingStream(totalBytes: number, chunk = 1024): { body: ReadableStream<Uint8Array>; pulled: () => number; reads: () => number } {
  let pulled = 0;
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled >= totalBytes) { c.close(); return; }
      reads++;
      const n = Math.min(chunk, totalBytes - pulled);
      pulled += n;
      c.enqueue(new Uint8Array(n).fill(0x20));
    },
  }, { highWaterMark: 0 });   // pull only when something reads, so `reads()` counts the reader and not the stream's own prefetch
  return { body, pulled: () => pulled, reads: () => reads };
}
const streamed = (url: string, s: ReadableStream<Uint8Array>, extra: Record<string, string> = {}): Request =>
  new Request(url, { method: 'POST', headers: headers(extra), body: s, duplex: 'half' } as RequestInit & { duplex: 'half' });

const CODE = 'ABCDEF';
interface Route { name: string; url: string; base: () => Promise<Record<string, unknown>>; atCapStatus: number }

async function routes(): Promise<Route[]> {
  const ticket = await signTicket('secret', { matchId: CODE, seat: 0, player: 'p', exp: NOW + 60_000 });
  return [
    { name: 'create', url: `${ORIGIN}/api/match`, base: async () => ({ player: 'p', build: 'b1' }), atCapStatus: 201 },
    { name: 'join', url: `${ORIGIN}/api/match/${CODE}/join`, base: async () => ({ player: 'p2' }), atCapStatus: 200 },
    { name: 'advisor', url: `${ORIGIN}/api/match/${CODE}/advisor`, base: async () => ({ ticket, scope: ADVISOR_SCOPES[0] }), atCapStatus: 200 },
  ];
}
/** A room the join route can find. */
async function withRoom(): Promise<ReturnType<typeof fakeRooms>> {
  const f = fakeRooms();
  await f.env.ROOMS!.get(f.env.ROOMS!.idFromName(CODE)).fetch(new Request('https://room/create', { method: 'POST', body: '{}' }));
  f.calls.length = 0;
  f.created.length = 0;
  return f;
}

describe('the /api/match body cap', () => {
  it('the cap constant is its literal', () => {
    expect(MATCH_BODY_MAX_BYTES).toBe(CAP_LITERAL);
  });

  it('the measured size recorded beside the constant is the one measured now (it must not go stale)', async () => {
    const src = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
    const m = src.match(/largest legitimate body measured (\d+) bytes/);
    expect(m, 'routes.ts must record the measured size beside MATCH_BODY_MAX_BYTES').not.toBeNull();
    expect(Number(m?.[1])).toBe(await measuredMax());
  });

  it('the largest legitimate body leaves headroom: it is at most cap / 1.5, and the cap at most 3x it', async () => {
    const max = await measuredMax();
    // Table growth that eats the headroom goes red here.
    expect(max).toBeLessThanOrEqual(MATCH_BODY_MAX_BYTES / 1.5);
    expect(MATCH_BODY_MAX_BYTES).toBeLessThanOrEqual(max * 3);
  });

  it('the full-brigade create body and the full join body are accepted', async () => {
    const { create, join } = legitimateBodies();
    const { env, created } = fakeRooms();
    const res = await handleMatch(postRaw(`${ORIGIN}/api/match`, JSON.stringify(create)), env, NOW);
    expect(res.status).toBe(201);
    const room = created[0] as { tiers: Record<string, Record<string, number>>; kit: string };
    expect(room.kit).toBe('brigade');
    expect(room.tiers).toEqual(fullTiers());   // the whole claim survived, so the body really was read
    const f = await withRoom();
    const j = await handleMatch(postRaw(`${ORIGIN}/api/match/${CODE}/join`, JSON.stringify(join)), f.env, NOW);
    expect(j.status).toBe(200);
  });

  for (const which of [0, 1, 2]) {
    it(`route ${['create', 'join', 'advisor'][which]}: one byte over the cap is 413, undeclared, and no room is asked`, async () => {
      const r = (await routes())[which];
      const f = await withRoom();
      const body = padded(await r.base(), MATCH_BODY_MAX_BYTES + 1);
      const res = await handleMatch(postRaw(r.url, body), f.env, NOW);
      expect(res.status).toBe(413);
      expect(f.calls).toEqual([]);
    });

    it(`route ${['create', 'join', 'advisor'][which]}: exactly at the cap is parsed and served, declared or not`, async () => {
      const r = (await routes())[which];
      const body = padded(await r.base(), MATCH_BODY_MAX_BYTES);
      const undeclared = await withRoom();
      const a = await handleMatch(postRaw(r.url, body), undeclared.env, NOW);
      expect(a.status).toBe(r.atCapStatus);
      expect(undeclared.calls.length).toBe(which === 2 ? 0 : 1);   // parsed: create/join reached the room
      const declared = await withRoom();
      const b = await handleMatch(postRaw(r.url, body, { 'content-length': String(MATCH_BODY_MAX_BYTES) }), declared.env, NOW);
      expect(b.status).toBe(r.atCapStatus);
    });

    it(`route ${['create', 'join', 'advisor'][which]}: a declared length over the cap is 413 without reading the body`, async () => {
      const r = (await routes())[which];
      const f = await withRoom();
      const s = countingStream(MATCH_BODY_MAX_BYTES + 1);
      const res = await handleMatch(streamed(r.url, s.body, { 'content-length': String(MATCH_BODY_MAX_BYTES + 1) }), f.env, NOW);
      expect(res.status).toBe(413);
      expect(s.reads()).toBe(0);
      expect(f.calls).toEqual([]);
    });

    it(`route ${['create', 'join', 'advisor'][which]}: a lying or absent length reads at most the cap plus one chunk, then 413`, async () => {
      const r = (await routes())[which];
      for (const extra of [{ 'content-length': '10' }, {}] as Record<string, string>[]) {
        const f = await withRoom();
        const s = countingStream(MATCH_BODY_MAX_BYTES * 8, 1024);   // far more than the cap, so an unbounded reader would take it all
        const res = await handleMatch(streamed(r.url, s.body, extra), f.env, NOW);
        expect(res.status).toBe(413);
        expect(s.pulled()).toBeLessThanOrEqual(MATCH_BODY_MAX_BYTES + 2 * 1024);
        expect(f.calls).toEqual([]);
      }
    });
  }
});

/** The snapshot upload's own cap (snapshot S3): `POST /api/match/:code/snapshot` carries gzip bytes, not
 *  JSON, so it has its own bound beside `MATCH_BODY_MAX_BYTES`. The Worker holds it twice, a declared
 *  length over it at once and the actual bytes through `readCapped`, and forwards the bytes it read. */
describe('the /api/match/:code/snapshot body cap', () => {
  /** 65,536 bytes (64 KiB) compressed. Measured: a real mid-game snapshot gzips to 16.1 KiB (design §12.3),
   *  about 18 KiB with the runtime (§13.3), so the cap is about 4x the first and 3.5x the second.
   *  The headroom is gated by `tools/src/net/snapshot-size.test.ts` (Task 13: measured <= cap / 2 at the
   *  browser's default gzip level). The literal is typed here on purpose: an oracle takes literals. */
  const SNAP_CAP_LITERAL = 65_536;
  const URL_ = `${ORIGIN}/api/match/${CODE}/snapshot`;
  const snapPost = async (body: BodyInit, extra: Record<string, string> = {}, stream = false): Promise<Request> => {
    const ticket = await signTicket('secret', { matchId: CODE, seat: 0, player: 'p', exp: NOW + 60_000 });
    return new Request(URL_, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/octet-stream', 'cf-connecting-ip': '203.0.113.9', authorization: `Bearer ${ticket}`, 'x-snapshot-tick': '1200', ...extra },
      body, ...(stream ? { duplex: 'half' } : {}),
    } as RequestInit);
  };

  it('the cap constant is its literal', () => {
    expect(SNAPSHOT_MAX_COMPRESSED_BYTES).toBe(SNAP_CAP_LITERAL);
    expect(SNAPSHOT_MAX_COMPRESSED_BYTES).not.toBe(MATCH_BODY_MAX_BYTES);   // its own bound, not the JSON routes'
  });

  it('a declared length of cap + 1 is 413 before the body is read and before any room is asked', async () => {
    const f = fakeRooms();
    const s = countingStream(SNAP_CAP_LITERAL + 1);
    const res = await handleMatch(await snapPost(s.body, { 'content-length': String(SNAP_CAP_LITERAL + 1) }, true), f.env, NOW);
    expect(res.status).toBe(413);
    expect(s.reads()).toBe(0);
    expect(f.calls).toEqual([]);
  });

  it('an undeclared cap + 1 is 413 and no room is asked', async () => {
    const f = fakeRooms();
    const res = await handleMatch(await snapPost(new Uint8Array(SNAP_CAP_LITERAL + 1)), f.env, NOW);
    expect(res.status).toBe(413);
    expect(f.calls).toEqual([]);
  });

  it('a lying or absent length reads at most the cap plus one chunk, then 413', async () => {
    for (const extra of [{ 'content-length': '10' }, {}] as Record<string, string>[]) {
      const f = fakeRooms();
      const s = countingStream(SNAP_CAP_LITERAL * 4, 4096);   // far more than the cap, so an unbounded reader would take it all
      const res = await handleMatch(await snapPost(s.body, extra, true), f.env, NOW);
      expect(res.status).toBe(413);
      expect(s.pulled()).toBeLessThanOrEqual(SNAP_CAP_LITERAL + 2 * 4096);
      expect(f.calls).toEqual([]);
    }
  });

  it('exactly the cap passes, declared or not, and the room is sent exactly the bytes read', async () => {
    const undeclared = fakeRooms();
    expect((await handleMatch(await snapPost(new Uint8Array(SNAP_CAP_LITERAL)), undeclared.env, NOW)).status).toBe(201);
    expect(undeclared.forwarded).toEqual([SNAP_CAP_LITERAL]);
    const declared = fakeRooms();
    const res = await handleMatch(await snapPost(new Uint8Array(SNAP_CAP_LITERAL), { 'content-length': String(SNAP_CAP_LITERAL) }), declared.env, NOW);
    expect(res.status).toBe(201);
    expect(declared.forwarded).toEqual([SNAP_CAP_LITERAL]);
    // A smaller body than it declared is forwarded as it really is.
    const lying = fakeRooms();
    expect((await handleMatch(await snapPost(new Uint8Array(100), { 'content-length': '60000' }), lying.env, NOW)).status).toBe(201);
    expect(lying.forwarded).toEqual([100]);
  });
});
