/**
 * GH-1397 T3 (design §8.3, D-R6): the game Worker and the relay as two Workers under Miniflare, each in its OWN
 * workerd process, joined by the dev registry the way `wrangler dev` joins two scripts: the game Worker's `ROOMS`
 * binding carries `script_name` and reaches the relay's `MatchRoom` across processes. Both are built from the real
 * entries (`index.ts`, `relay.ts`) and the real parsed configs (`wrangler.jsonc`, `wrangler.relay.jsonc`, and the
 * cut as `cutConfig` gives it), so this runs the config, not a copy of it.
 *
 * A "game-Worker restart" here is the game process disposed and a new one started on the same registry. That is
 * harsher than a Cloudflare deploy: the client's socket ends at the game process here, so it DROPS, where on
 * Cloudflare the design expects it to stay open (§12 fact 2, which only the lead's staging run of §8.4 can
 * measure). What this proves is the room side: the relay holds the room across the restart, the seats reconnect
 * through the new game process with their old tickets, and the room's state (config, frame log, seats, clock) is
 * the one they left. With today's topology the same restart loses the room, and that is the switch-off identity:
 * `ROOMS_NEW=0` after the cut behaves as today does, to the message.
 *
 * Miniflare is a model of Cloudflare, not Cloudflare (design §8.3): it cannot replace §8.4.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT, bundleWorker, type WorkerBundle } from './worker-bundle';
import { RELAY_MAIN, ROOM_CLASS, cutConfig, readCfg, type WranglerCfg } from './wrangler-cfg';

const SECRET = 'relay-split-test-secret';
const BUILD = 'b-relay-split';
const ORIGIN = 'http://localhost';
const WAIT_MS = 8_000;

type V4 = Parameters<typeof convertV4MiniflareOptions>[0];
type V4Worker = Extract<V4, { workers: unknown }>['workers'][number];

const gameCfg = readCfg('wrangler.jsonc');
const relayCfg = readCfg('wrangler.relay.jsonc');
const RELAY_NAME = String(relayCfg.name);

let gameBundle: WorkerBundle;
let relayBundle: WorkerBundle;
beforeAll(async () => {
  [gameBundle, relayBundle] = await Promise.all([bundleWorker('packages/worker/src/index.ts'), bundleWorker(RELAY_MAIN)]);
}, 60_000);

/** Every process a test started, disposed after it whatever happened. */
const live = new Set<Miniflare>();
const dirs: string[] = [];
afterEach(async () => { await Promise.allSettled([...live].map((mf) => mf.dispose())); live.clear(); });
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = (prefix: string): string => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };

const d1Of = (cfg: WranglerCfg): Record<string, string> => Object.fromEntries((cfg.d1_databases ?? []).map((d) => [d.binding, d.database_name ?? d.binding]));

/** The game Worker as `cfg` declares it: every DO binding with `script_name` is external (the relay), every other one
 *  is the game Worker's own class. Rate limiters are left unbound (`Env` treats them as optional), and `ASSETS`
 *  answers from Node. */
function gameWorker(cfg: WranglerCfg, vars: Record<string, string>): V4Worker {
  const durableObjects = Object.fromEntries((cfg.durable_objects?.bindings ?? []).map((b) => [b.name, b.script_name === undefined ? { className: b.class_name, useSQLite: true } : { className: b.class_name, scriptName: b.script_name }]));
  return {
    name: String(cfg.name), compatibilityDate: String(cfg.compatibility_date), modules: true, script: gameBundle.code,
    durableObjects, d1Databases: d1Of(cfg), bindings: { TICKET_SECRET: SECRET, ...vars },
    serviceBindings: { ASSETS: () => new Response('asset') },
  };
}
/** The relay as `wrangler.relay.jsonc` declares it: the class is hosted (a migration, no binding), plus its D1s. */
function relayWorker(secret: string): V4Worker {
  if (!(relayCfg.migrations ?? []).some((m) => (m.new_sqlite_classes ?? []).includes(ROOM_CLASS))) throw new Error('the relay config hosts no MatchRoom');
  return {
    name: RELAY_NAME, compatibilityDate: String(relayCfg.compatibility_date), modules: true, script: relayBundle.code,
    additionalUnboundDurableObjects: [{ className: ROOM_CLASS, useSQLite: true }], d1Databases: d1Of(relayCfg), bindings: { TICKET_SECRET: secret },
  };
}
async function start(worker: V4Worker, registry: string, persist?: string): Promise<Miniflare> {
  // Persistence is Miniflare 5's `resourcePersistencePath` (the v4 `durableObjectsPersist` is not converted).
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ unsafeDevRegistryPath: registry, workers: [worker] }), ...(persist === undefined ? {} : { resourcePersistencePath: persist }) });
  live.add(mf);
  await mf.ready;
  return mf;
}
async function stop(mf: Miniflare): Promise<void> { live.delete(mf); await mf.dispose(); }

interface Msg { t: string; tick?: number; config?: unknown; frames?: { tick: number }[]; reason?: string; code?: string; seats?: unknown[] }
/** One seat's socket through the game Worker: records every message, acks every frame, and remembers its close. */
class Seat {
  msgs: Msg[] = [];
  closed: number | null = null;
  private ws: { send(s: string): void; close(): void } | null = null;
  constructor(readonly ticket: string) {}
  async connect(game: Miniflare, code: string, from?: number): Promise<void> {
    const res = await game.dispatchFetch(`${ORIGIN}/api/match/${code}/ws`, { headers: { upgrade: 'websocket', origin: ORIGIN } });
    const ws = res.webSocket;
    if (res.status !== 101 || ws === null) throw new Error(`upgrade answered ${res.status}`);
    ws.accept();
    this.closed = null;
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as Msg;
      this.msgs.push(m);
      if (m.t === 'frame' && typeof m.tick === 'number') ws.send(JSON.stringify({ t: 'ack', tick: m.tick }));
    });
    ws.addEventListener('close', (e) => { this.closed = e.code; });
    this.ws = ws;
    this.send({ t: 'hello', ticket: this.ticket, build: BUILD, ...(from === undefined ? {} : { from }) });
  }
  send(m: unknown): void { this.ws?.send(JSON.stringify(m)); }
  /** The highest frame tick this seat has been sent, live or in a log. */
  lastTick(): number { let t = -1; for (const m of this.msgs) { if (m.t === 'frame' && typeof m.tick === 'number') t = Math.max(t, m.tick); if (m.t === 'log') for (const f of m.frames ?? []) t = Math.max(t, f.tick); } return t; }
  types(): string[] { return this.msgs.map((m) => m.t); }
}
async function retry(what: string, fn: () => Promise<void>, ms = WAIT_MS): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try { await fn(); return; } catch (e) { if (Date.now() > end) throw new Error(`timed out retrying ${what}`, { cause: e }); }
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function until(what: string, pred: () => boolean, ms = WAIT_MS): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 20)); }
}
const post = (game: Miniflare, path: string, body: unknown) =>
  game.dispatchFetch(`${ORIGIN}${path}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify(body) });

/** Create a room, seat both, ready both, and let it run past `ticks`. */
async function openMatch(game: Miniflare, ticks = 20): Promise<{ code: string; host: Seat; guest: Seat; config: unknown; statuses: number[] }> {
  const created = await post(game, '/api/match', { player: 'p-host', callsign: 'Host', build: BUILD });
  const { code, ticket } = (await created.json()) as { code: string; ticket: string };
  const joined = await post(game, `/api/match/${code}/join`, { player: 'p-guest', callsign: 'Guest', build: BUILD });
  const { ticket: guestTicket } = (await joined.json()) as { ticket: string };
  const host = new Seat(ticket);
  const guest = new Seat(guestTicket);
  await host.connect(game, code);
  await guest.connect(game, code);
  await until('both lobbies', () => host.types().includes('lobby') && guest.types().includes('lobby'));
  host.send({ t: 'ready' });
  guest.send({ t: 'ready' });
  await until('start', () => host.types().includes('start') && guest.types().includes('start'));
  await until(`tick ${ticks}`, () => host.lastTick() >= ticks && guest.lastTick() >= ticks);
  const config = host.msgs.find((m) => m.t === 'start')?.config;
  return { code, host, guest, config, statuses: [created.status, joined.status] };
}

describe('miniflare pin (D-R6)', () => {
  it('miniflare is an exact version, and it is the one the lockfile resolved', () => {
    const pkg = JSON.parse(readFileSync(REPO_ROOT + 'package.json', 'utf8')) as { devDependencies?: Record<string, string> };
    expect(exactPinProblems(pkg.devDependencies?.miniflare, readFileSync(REPO_ROOT + 'pnpm-lock.yaml', 'utf8'))).toEqual([]);
  });
  it('falsification: a range, an absent pin, or a lockfile that resolved another version', () => {
    const lock = readFileSync(REPO_ROOT + 'pnpm-lock.yaml', 'utf8');
    expect(exactPinProblems('^5.20261006.1-alpha', lock)).toHaveLength(1);
    expect(exactPinProblems('~5.20261006.1-alpha', lock)).toHaveLength(1);
    expect(exactPinProblems(undefined, lock)).toHaveLength(1);
    expect(exactPinProblems('5.20261006.1-alpha', lock.replace(/(\n {6}miniflare:\n {8}specifier: \S+\n {8}version: )5\.20261006\.1-alpha/, '$15.0.0'))).toHaveLength(1);
  });
});

/** The pin: an exact semver (no range operator), and the root importer's lockfile entry resolved exactly it. */
export function exactPinProblems(spec: string | undefined, lock: string): string[] {
  if (spec === undefined) return ['miniflare is not a devDependency'];
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(spec)) return [`miniflare is pinned as ${spec}, not an exact version`];
  const m = lock.match(/\n {6}miniflare:\n {8}specifier: (\S+)\n {8}version: ([^(\s]+)/);
  if (m === null || m[1] !== spec || m[2] !== spec) return [`the lockfile resolved miniflare as ${m?.[2] ?? 'nothing'}, not ${spec}`];
  return [];
}

describe('GH-1397 T3: two Workers under Miniflare', () => {
  it('an open room survives a game-Worker restart: the relay holds it, the seats reconnect, its state is intact', async () => {
    const registry = scratch('rl-relay-reg-');
    await start(relayWorker(SECRET), registry);
    const cut = cutConfig(gameCfg, RELAY_NAME);
    let game = await start(gameWorker(cut, {}), registry);
    const { code, host, guest, config, statuses } = await openMatch(game);
    expect(statuses).toEqual([201, 200]);
    const before = Math.min(host.lastTick(), guest.lastTick());

    await stop(game);   // the game Worker restarts: its process is gone
    await until('both sockets dropped', () => host.closed !== null && guest.closed !== null);
    game = await start(gameWorker(cut, {}), registry);

    // Their old tickets (signed by the old game process) still verify: the relay's room checks them.
    host.msgs = []; guest.msgs = [];
    await host.connect(game, code);
    await guest.connect(game, code);
    await until('both logs', () => host.types().includes('log') && guest.types().includes('log'));
    const log = host.msgs.find((m) => m.t === 'log');
    expect(log?.config).toEqual(config);                 // the same match, seed and all
    expect(host.lastTick()).toBeGreaterThanOrEqual(before); // the frame log the seats left
    expect(host.types()).not.toContain('ended');
    // The room's clock runs on from where it was, never from 0.
    await until('live frames after the restart', () => host.msgs.some((m) => m.t === 'frame' && (m.tick ?? -1) > before + 5));
    // The seats are still taken: a third player is refused as full, not told there is no room.
    expect((await post(game, `/api/match/${code}/join`, { player: 'p-third', build: BUILD })).status).toBe(409);
  }, 60_000);

  it('switch-off identity: with today\'s config, and with the cut plus ROOMS_NEW=0, the same restart ends the room the same way', async () => {
    const runs: { open: string[][]; config: string; after: string[]; join: number }[] = [];
    for (const shape of ['today', 'cut+ROOMS_NEW=0'] as const) {
      const registry = scratch('rl-relay-reg-');
      const relay = await start(relayWorker(SECRET), registry);
      const cfg = shape === 'today' ? gameCfg : cutConfig(gameCfg, RELAY_NAME);
      const vars: Record<string, string> = shape === 'today' ? {} : { ROOMS_NEW: '0' };
      let game = await start(gameWorker(cfg, vars), registry);
      const { code, host, guest, config } = await openMatch(game);
      // The lobby broadcasts race the two readies, so a seat's message KINDS are compared, not their count.
      const open = [host, guest].map((s) => [...new Set(s.types().filter((t) => t !== 'frame'))]);
      await stop(game);
      await until('both sockets dropped', () => host.closed !== null && guest.closed !== null);
      game = await start(gameWorker(cfg, vars), registry);
      host.msgs = [];
      await host.connect(game, code);
      await until('the answer to the rejoin', () => host.closed !== null);
      runs.push({ open, config: JSON.stringify(config).replaceAll(code, 'CODE').replace(/"player":"[0-9a-f]+"/g, '"player":"ID"'), after: host.types(), join: (await post(game, `/api/match/${code}/join`, { player: 'p-third', build: BUILD })).status });
      await stop(game);
      await stop(relay);
    }
    // Today: the room lived in the game Worker and went with it. The lever selects that same namespace.
    expect(runs[0]).toMatchObject({ open: [['lobby', 'start'], ['lobby', 'start']], after: ['ended'], join: 404 });
    expect(runs[0]?.config).toContain('"seed"');   // a sandbox room's seed is fixed, so the whole config compares
    expect(runs[1]).toEqual(runs[0]);
  }, 60_000);

  it('a relay restart drops the sockets and the room comes back from its storage (design §8.3)', async () => {
    const registry = scratch('rl-relay-reg-');
    const persist = scratch('rl-relay-do-');
    const relay = await start(relayWorker(SECRET), registry, persist);
    const game = await start(gameWorker(cutConfig(gameCfg, RELAY_NAME), {}), registry);
    const { code, host, guest, config } = await openMatch(game);
    const before = Math.min(host.lastTick(), guest.lastTick());
    await stop(relay);
    await until('both sockets dropped', () => host.closed !== null && guest.closed !== null);
    await start(relayWorker(SECRET), registry, persist);   // the relay's new version, on the same storage
    host.msgs = [];
    // The game process learns the relay's new address from the registry a moment later (a 503 until then).
    await retry('the upgrade through the restarted relay', () => host.connect(game, code));
    await until('the log', () => host.types().includes('log') || host.closed !== null);
    expect(host.types()).not.toContain('ended');
    expect(host.msgs.find((m) => m.t === 'log')?.config).toEqual(config);
    expect(host.lastTick()).toBeGreaterThan(0);
    expect(host.lastTick()).toBeLessThanOrEqual(before + 1);   // what was persisted, not more
  }, 60_000);

  it('ticket parity (F9): the room in the relay verifies what the game Worker signed, and refuses another secret', async () => {
    const registry = scratch('rl-relay-reg-');
    await start(relayWorker('a-different-secret'), registry);
    const game = await start(gameWorker(cutConfig(gameCfg, RELAY_NAME), {}), registry);
    const created = await post(game, '/api/match', { player: 'p-host', build: BUILD });
    expect(created.status).toBe(201);
    const { code, ticket } = (await created.json()) as { code: string; ticket: string };
    const host = new Seat(ticket);
    await host.connect(game, code);
    await until('the refusal', () => host.closed !== null);
    expect(host.msgs).toEqual([{ t: 'error', code: 'bad_ticket' }]);
  }, 60_000);

  it('order (design §8.3): a game Worker bound to a relay that is not running fails loudly, and makes no room', async () => {
    const registry = scratch('rl-relay-reg-');
    const game = await start(gameWorker(cutConfig(gameCfg, RELAY_NAME), {}), registry);
    const created = await post(game, '/api/match', { player: 'p-host', build: BUILD });
    expect(created.status).toBeGreaterThanOrEqual(500);
  }, 60_000);
});
