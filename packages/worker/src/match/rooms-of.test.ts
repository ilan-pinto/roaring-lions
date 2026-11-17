/**
 * GH-1397 T1 (design §8.1, F5 to F7): `roomsOf`, the one reader of `env.ROOMS` and `env.ROOMS_LEGACY`.
 *
 * - F5: the switch itself. Unset or any value but `'0'` is `ROOMS`; `'0'` is `ROOMS_LEGACY` only when it is bound.
 * - F6: every route (create, join, the upgrade, snapshot, watch; the advisor ticket asks no room) is driven
 *   through `handleMatch` with each namespace chosen, and touches that namespace only.
 * - F7: a scan of the Worker's source: nothing but `roomsOf` reads either binding.
 * - Switch-off identity: with `ROOMS_LEGACY` unbound (today's `wrangler.jsonc`, unchanged by this slice) the
 *   routes' transcript is BYTE FOR BYTE today's. The digest below was recorded by running this transcript
 *   against `origin/main`'s `routes.ts` (5147ce2, before `roomsOf` existed) and is a literal on purpose. A
 *   deliberate change to a route's bytes updates it in the same commit and says why (like the determinism hash).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectNamespaceLike, Env } from '../d1';
import { REPO_ROOT } from '../worker-bundle';
import { handleMatch, roomsOf } from './routes';
import { signTicket } from './ticket';

const NOW = 1_790_000_000_000;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';
/** sha256 of `JSON.stringify(transcript)` for today's env shape, recorded against origin/main's routes.ts. */
const TODAY_TRANSCRIPT_SHA256 = '2576cc626309cf02fc23c3027b93d65d2002e5700397f8ea46618cbedc3c7970';

interface Call { ns: string; id: string; method: string; url: string; headers: [string, string][]; body: string }
const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sortedHeaders = (h: Headers): [string, string][] => [...h.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** A namespace that records every request any of its stubs is sent, tagged with `label`, and answers as a room
 *  would (one room per name, seat 1 reserved at join, a 412 for another build, a 404 for an absent room). */
function recordingRooms(label: string, calls: Call[]): DurableObjectNamespaceLike {
  const rooms = new Map<string, { seats: number }>();
  return {
    idFromName: (n: string) => `${label}:${n}`,
    get: (id: unknown) => ({
      fetch: async (req: Request): Promise<Response> => {
        const key = String(id);
        const path = new URL(req.url).pathname;
        const raw = req.body === null ? '' : hex(await req.arrayBuffer());
        calls.push({ ns: label, id: key, method: req.method, url: req.url, headers: sortedHeaders(req.headers), body: raw });
        const room = rooms.get(key);
        if (path === '/create') { if (room) return new Response('exists', { status: 409 }); rooms.set(key, { seats: 1 }); return Response.json({ ok: true }); }
        if (!room) return new Response('no such room', { status: 404 });
        if (path === '/join') {
          const jb = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw.match(/../g) ?? [], (h) => parseInt(h, 16))) || '{}') as { build?: string };
          if (jb.build === 'other-build') return Response.json({ error: 'build_mismatch', build: 'b1' }, { status: 412 });
          if (room.seats >= 2) return new Response('', { status: 409 });
          room.seats++;
          return Response.json({ seat: 1 });
        }
        if (path === '/kinds') return Response.json({ kinds: ['bot', 'bot'] });
        if (path === '/ws') return new Response('upgraded', { status: 200 });
        if (path === '/snapshot') return req.method === 'POST' ? new Response('stored', { status: 201 }) : new Response(new Uint8Array([7, 8, 9]), { status: 200, headers: { 'x-snapshot-tick': '1200' } });
        return new Response('not found', { status: 404 });
      },
    }),
  };
}

/** A seeded `crypto.getRandomValues`, so `mintCode` draws the same codes in every run. */
function seedCrypto(): void {
  let s = 0x9e3779b9;
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
    if (a instanceof Uint32Array) for (let i = 0; i < a.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = s; }
    return a;
  });
}
afterEach(() => { vi.restoreAllMocks(); });

const baseEnv = (): Env => ({ DB: {} as Env['DB'], ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: 'secret', ARENA_WATCH: '1' }) as Env;
const post = (url: string, body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(url, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...headers }, body: JSON.stringify(body) });

interface Step { req: string; status: number; headers: [string, string][]; body: string; calls: Call[] }
export type Handle = (req: Request, env: Env, now: number) => Promise<Response>;

/** Every `/api/match*` route that reaches a room, plus the advisor ticket and the refusals around them, in order. */
export async function transcriptOf(handle: Handle, env: Env, calls: Call[]): Promise<Step[]> {
  seedCrypto();
  const steps: Step[] = [];
  const run = async (label: string, req: Request): Promise<Response> => {
    const before = calls.length;
    const res = await handle(req, env, NOW);
    const body = await res.clone().text();
    steps.push({ req: label, status: res.status, headers: sortedHeaders(res.headers), body, calls: calls.slice(before) });
    return res;
  };
  const created = (await (await run('create', post(`${ORIGIN}/api/match`, { player: 'p-host', callsign: 'Host', build: 'b1', kind: 'bot', pace: 1 }))).json()) as { code: string; ticket: string };
  const { code, ticket } = created;
  await run('join (other build)', post(`${ORIGIN}/api/match/${code}/join`, { player: 'p-two', build: 'other-build' }));
  await run('join', post(`${ORIGIN}/api/match/${code.toLowerCase()}/join`, { player: 'p-two', callsign: 'Two', kind: 'bot', build: 'b1' }));
  await run('join (full)', post(`${ORIGIN}/api/match/${code}/join`, { player: 'p-three' }));
  await run('ws', new Request(`${ORIGIN}/api/match/${code}/ws`, { headers: { origin: ORIGIN, upgrade: 'websocket', 'cf-connecting-ip': '203.0.113.9' } }));
  await run('advisor', post(`${ORIGIN}/api/match/${code}/advisor`, { ticket, scope: 'assist' }));
  await run('watch', post(`${ORIGIN}/api/match/${code}/watch`, { ticket }));
  await run('snapshot POST', new Request(`${ORIGIN}/api/match/${code}/snapshot`, { method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${ticket}`, 'x-snapshot-tick': '1200' }, body: new Uint8Array([1, 2, 3, 4]) }));
  await run('snapshot GET', new Request(`${ORIGIN}/api/match/${code}/snapshot`, { headers: { 'sec-fetch-site': 'same-origin', authorization: `Bearer ${ticket}` } }));
  const absent = 'ZZZZZZ';
  const absentTicket = await signTicket('secret', { matchId: absent, seat: 0, player: 'p-host', exp: NOW + 60_000 });
  await run('join (absent)', post(`${ORIGIN}/api/match/${absent}/join`, { player: 'p-two' }));
  await run('ws (absent)', new Request(`${ORIGIN}/api/match/${absent}/ws`, { headers: { origin: ORIGIN, upgrade: 'websocket' } }));
  await run('watch (absent)', post(`${ORIGIN}/api/match/${absent}/watch`, { ticket: absentTicket }));
  await run('snapshot GET (absent)', new Request(`${ORIGIN}/api/match/${absent}/snapshot`, { headers: { origin: ORIGIN, authorization: `Bearer ${absentTicket}` } }));
  await run('create (GET)', new Request(`${ORIGIN}/api/match`, { headers: { origin: ORIGIN } }));
  await run('bad code', post(`${ORIGIN}/api/match/ABC/join`, { player: 'p' }));
  await run('no origin', new Request(`${ORIGIN}/api/match`, { method: 'POST', body: '{}' }));
  return steps;
}

const sha256 = async (s: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
/** One run of the transcript under `env`, with namespaces built by `make` around a shared call log. */
export async function runWith(make: (calls: Call[]) => Partial<Env>, handle: Handle = handleMatch): Promise<{ steps: Step[]; calls: Call[]; json: string }> {
  const calls: Call[] = [];
  const env = { ...baseEnv(), ...make(calls) } as Env;
  const steps = await transcriptOf(handle, env, calls);
  return { steps, calls, json: JSON.stringify(steps) };
}
export const today = (calls: Call[]): Partial<Env> => ({ ROOMS: recordingRooms('game', calls) });
/** The cut (design §4): ROOMS is the relay's, the game Worker's own class is the lever. */
const cut = (newValue: string | undefined) => (calls: Call[]): Partial<Env> => ({
  ROOMS: recordingRooms('relay', calls), ROOMS_LEGACY: recordingRooms('game', calls), ...(newValue === undefined ? {} : { ROOMS_NEW: newValue }),
});

describe('GH-1397 F5: roomsOf', () => {
  const A = recordingRooms('A', []);
  const B = recordingRooms('B', []);
  it('unset, and every value but exactly "0", is ROOMS', () => {
    expect(roomsOf({ ...baseEnv(), ROOMS: A })).toBe(A);
    expect(roomsOf({ ...baseEnv(), ROOMS: A, ROOMS_LEGACY: B })).toBe(A);
    for (const v of ['', '1', 'true', 'false', ' 0', '0 ', '00', 'off', 'O']) expect(roomsOf({ ...baseEnv(), ROOMS: A, ROOMS_LEGACY: B, ROOMS_NEW: v })).toBe(A);
  });
  it('"0" with ROOMS_LEGACY bound is the legacy namespace', () => {
    expect(roomsOf({ ...baseEnv(), ROOMS: A, ROOMS_LEGACY: B, ROOMS_NEW: '0' })).toBe(B);
  });
  it('"0" with ROOMS_LEGACY unbound is still ROOMS: the switch never yields undefined', () => {
    expect(roomsOf({ ...baseEnv(), ROOMS: A, ROOMS_NEW: '0' })).toBe(A);
  });
  it('with nothing bound it is undefined, and the routes answer 503 as today', async () => {
    expect(roomsOf({ ...baseEnv(), ROOMS_NEW: '0' })).toBeUndefined();
    const res = await handleMatch(post(`${ORIGIN}/api/match`, { player: 'p', build: 'b1' }), { ...baseEnv(), ROOMS_NEW: '0' }, NOW);
    expect(res.status).toBe(503);
  });
});

describe('GH-1397 F6: every route asks the one namespace roomsOf chose', () => {
  it('the cut with the switch unset: every room call goes to the relay, none to the lever', async () => {
    const { calls } = await runWith(cut(undefined));
    expect(calls.length).toBeGreaterThanOrEqual(10);   // not vacuous: create, joins, ws, watch, snapshots, absents
    expect(new Set(calls.map((c) => c.ns))).toEqual(new Set(['relay']));
    expect(new Set(calls.map((c) => new URL(c.url).pathname))).toEqual(new Set(['/create', '/join', '/ws', '/kinds', '/snapshot']));
  });
  it('the cut with ROOMS_NEW=0: every room call goes to the lever, none to the relay', async () => {
    const { calls } = await runWith(cut('0'));
    expect(calls.length).toBeGreaterThanOrEqual(10);
    expect(new Set(calls.map((c) => c.ns))).toEqual(new Set(['game']));
  });
  it('an absent room in the chosen namespace answers as today (no such room / 404), and the other is never probed', async () => {
    const { steps } = await runWith(cut(undefined));
    const absent = steps.filter((s) => s.req.endsWith('(absent)'));
    expect(absent.map((s) => [s.req, s.status])).toEqual([['join (absent)', 404], ['ws (absent)', 404], ['watch (absent)', 404], ['snapshot GET (absent)', 404]]);
    for (const s of absent) expect(s.calls.map((c) => c.ns)).toEqual(['relay']);
  });
});

describe('GH-1397: switch off is today, byte for byte', () => {
  it('today\'s env shape (ROOMS alone) gives the transcript recorded against origin/main', async () => {
    const { json } = await runWith(today);
    expect(await sha256(json)).toBe(TODAY_TRANSCRIPT_SHA256);
  });
  it('every off shape is today\'s transcript to the byte: ROOMS_NEW unset, "0" with no lever, any other value; and the cut with "0"', async () => {
    const base = (await runWith(today)).json;
    for (const v of [undefined, '0', '1', '']) {
      const shaped = (calls: Call[]): Partial<Env> => ({ ...today(calls), ...(v === undefined ? {} : { ROOMS_NEW: v }) });
      expect((await runWith(shaped)).json).toBe(base);
    }
    // After the cut, ROOMS_NEW=0 is today's game-Worker namespace, and the relay is never asked.
    expect((await runWith(cut('0'))).json).toBe(base);
  });
  it('the cut with the switch unset is today\'s transcript with only the namespace changed', async () => {
    const base = (await runWith(today)).json;
    const relayed = (await runWith(cut(undefined))).json;
    expect(relayed).not.toBe(base);
    expect(relayed.replaceAll('"ns":"relay","id":"relay:', '"ns":"game","id":"game:')).toBe(base);
  });
});

/** F7: the Worker's non-test source, with comments stripped and `roomsOf`'s own body removed, reads neither binding. */
export function bindingReadsOutsideRoomsOf(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [file, src] of Object.entries(files)) {
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/export function roomsOf\([^)]*\)[^{]*\{[\s\S]*?\n\}/, '');
    // A read: `x.ROOMS`, `x?.ROOMS`, `x['ROOMS']`, or a destructuring out of an env. A string naming the binding
    // (`wrangler-cfg.ts`'s config reader) or the `Env` declaration (`ROOMS?:`) is not one.
    if (/\.\s*ROOMS(_LEGACY)?\b|\[\s*['"`]ROOMS(_LEGACY)?['"`]\s*\]|\{[^}]*\bROOMS(_LEGACY)?\b[^}]*\}\s*=\s*[\w.]*env\b/.test(code)) out.push(file);
  }
  return out;
}
function workerSources(): Record<string, string> {
  const root = join(REPO_ROOT, 'packages/worker/src');
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out[p.slice(root.length + 1)] = readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return out;
}

describe('GH-1397 F7: roomsOf is the only reader of either binding', () => {
  it('the Worker\'s source', () => {
    const files = workerSources();
    expect(Object.keys(files)).toContain('match/routes.ts');
    expect(bindingReadsOutsideRoomsOf(files)).toEqual([]);
  });
  it('falsification: a direct env.ROOMS read in a new handler, or a second-namespace probe', () => {
    const routes = workerSources()['match/routes.ts'] ?? '';
    expect(bindingReadsOutsideRoomsOf({ 'match/routes.ts': routes + '\nasync function x(env: Env) { return env.ROOMS?.get(env.ROOMS.idFromName("A")); }\n' })).toEqual(['match/routes.ts']);
    expect(bindingReadsOutsideRoomsOf({ 'match/routes.ts': routes + '\nconst probe = (env: Env) => env.ROOMS_LEGACY;\n' })).toEqual(['match/routes.ts']);
    expect(bindingReadsOutsideRoomsOf({ 'index.ts': 'const r = env["ROOMS"];' })).toEqual(['index.ts']);
    expect(bindingReadsOutsideRoomsOf({ 'index.ts': 'const { ROOMS_LEGACY } = env;' })).toEqual(['index.ts']);
    // Not reads: the Env declaration and a config reader naming the binding.
    expect(bindingReadsOutsideRoomsOf({ 'd1.ts': '  ROOMS?: DurableObjectNamespaceLike;', 'cfg.ts': "b.name === 'ROOMS'" })).toEqual([]);
  });
});
