/**
 * `pnpm net:rejoin-measure` (snapshot S4 Task 1C): how long a REAL browser seat
 * takes to come back from a reload today, and how long the other seat is frozen
 * meanwhile. Today's reload replays the whole frame log from tick 0 (spec
 * 2026-10-25-net-sim-snapshot-design §2.2); this is the "before" that S4's
 * payoff is judged against.
 *
 *   pnpm net:rejoin-measure -- [--port=5251] [--ticks=6000,24000] [--modes=off]
 *                              [--tick-ms=50] [--out=<file.json>] [--no-browser]
 *
 * NEVER RUNS IN CI, and no test starts it: it opens one Chromium on Metal and
 * takes about 21 minutes, nearly all of it Node pre-play at the room's real
 * 50 ms tick. The pure parts (the argument parser, the phase arithmetic and the
 * frozen-gap reader) are what `rejoin-measure.test.ts` covers.
 *
 * What it does, in order:
 *  1. Claims its own port (`claimPort`, default 5251; never 5177), launches ONE
 *     headless Chromium on Metal (ANGLE) and refuses to go on unless the
 *     unmasked renderer string says Metal. The GPU string is printed.
 *  2. Per mode: a local relay (real Worker routes, real `MatchRoom`, tick
 *     `--tick-ms`), a dev server of this checkout whose `/api` proxy is pointed
 *     at that relay (`LIONS_API_TARGET`), and one warm-up boot so a cold Vite
 *     transform cannot eat the 60 s forfeit clock.
 *  3. Per tick count, a KDF v Sarim `tel_marum` room with two scripted `rush`
 *     seats in Node (the log carries orders and the world fights). All rooms
 *     pre-play CONCURRENTLY.
 *  4. When a room reaches its tick count: seat 0's stats are taken, seat 1's
 *     client detaches with no `bye` (a reload), and the browser opens
 *     `/free-play/tel_marum?net=<CODE>&seat=1` with seat 1's ticket in
 *     `sessionStorage`, music off. `window.__lions` first defined is the boot;
 *     `__lions.net().status` live with the sim at the drop's tick is "live".
 *  5. Seat 0's newest tick is sampled every 10 ms: the longest stretch with no
 *     new frame, inside the window from the drop to live, is the frozen time.
 *
 * Writes the table as JSON (`--out`, default the OS temp directory, never the
 * repo). `--no-browser` pre-plays and reports in Node only, so the Node half
 * and "does the match still stand at that tick" can be checked without a GPU.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { ensureDevServer, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { claimPort } from '../ui-review/port';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { startLocalRelay, type LocalRelay } from './local-relay';
import { buildId } from './build-id';
import { inProcess, rush, type RunningPlayer } from './players';
import type { NetStats } from '@lions/net';

// ---------------------------------------------------------------- pure parts

export const MODES = ['off'] as const;
export type Mode = (typeof MODES)[number];

/** The room cap (`MATCH_CAP_TICKS`, 25 min): a room is not measured past it. */
const MAX_TICKS = 30_000;
const USAGE = 'usage: pnpm net:rejoin-measure -- [--port=5251] [--ticks=6000,24000] [--modes=off] [--tick-ms=50] [--out=<file.json>] [--no-browser]';

export interface MeasureArgs {
  /** Ascending, unique. */
  ticks: number[];
  modes: Mode[];
  /** The relay rooms' clock period in ms. */
  tickMs: number;
  out: string | null;
  /** false: pre-play and report in Node only. */
  browser: boolean;
}

/** The command line, or what is wrong with it. `--port=` is read by `claimPort`, not here. */
export function parseArgs(argv: readonly string[]): MeasureArgs | { error: string } {
  let ticks = [6000, 24000];
  let modes: Mode[] = ['off'];
  let tickMs = 50;
  let out: string | null = null;
  let browser = true;
  for (const arg of argv) {
    if (arg === '--') continue;   // pnpm passes the separator through
    if (arg === '--no-browser') { browser = false; continue; }
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg : arg.slice(0, eq);
    const value = eq < 0 ? undefined : arg.slice(eq + 1);
    if (name === '--port') {
      if (value === undefined) return { error: `--port needs a value\n${USAGE}` };
      continue;
    }
    if (!['--ticks', '--modes', '--tick-ms', '--out'].includes(name)) return { error: `unknown option ${name}\n${USAGE}` };
    if (value === undefined || value === '') return { error: `${name} needs a value: write ${name}=<value>` };
    if (name === '--ticks') {
      const parts = value.split(',');
      const parsed: number[] = [];
      for (const p of parts) {
        if (!/^\d+$/.test(p)) return { error: `--ticks is a comma-separated list of whole numbers, got "${p}"` };
        const n = Number(p);
        if (n < 100 || n >= MAX_TICKS) return { error: `--ticks entries are 100-${MAX_TICKS - 1}, got ${n}` };
        parsed.push(n);
      }
      if (new Set(parsed).size !== parsed.length) return { error: '--ticks entries must be distinct' };
      ticks = parsed.sort((a, b) => a - b);
    } else if (name === '--modes') {
      const parts = value.split(',');
      for (const p of parts) if (!(MODES as readonly string[]).includes(p)) return { error: `unknown mode "${p}": ${MODES.join(', ')}` };
      if (new Set(parts).size !== parts.length) return { error: '--modes entries must be distinct' };
      modes = parts as Mode[];
    } else if (name === '--tick-ms') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1000) return { error: '--tick-ms is 1-1000' };
      tickMs = Number(value);
    } else {
      out = value;
    }
  }
  return { ticks, modes, tickMs, out, browser };
}

/** Wall-clock stamps of one rejoin, in ms on one clock. `bootAt`/`liveAt` are null until seen. */
export interface Timeline { navAt: number; bootAt: number | null; liveAt: number | null }
export interface Phases {
  /** Navigation to `window.__lions` first defined. */
  bootMs: number;
  /** Navigation to live (the sim at the drop's tick, status live, behind <= 2). */
  liveMs: number;
  /** Boot to live: the part a snapshot shortens. */
  replayMs: number;
}

/** The phases from a timeline, or null if the rejoin never got that far. */
export function phases(t: Timeline): Phases | null {
  if (t.bootAt === null || t.liveAt === null) return null;
  return { bootMs: t.bootAt - t.navAt, liveMs: t.liveAt - t.navAt, replayMs: t.liveAt - t.bootAt };
}

export interface TickSample { t: number; tick: number }
export interface Frozen {
  /** The longest stretch in the window with no new frame at seat 0. */
  longestMs: number;
  /** `longestMs` in room ticks of `tickMs`. */
  longestRoomTicks: number;
  /** Seat 0's newest tick just before that stretch. */
  tickBeforeLongest: number;
  /** The sum of every stretch longer than `3 * tickMs`: the whole time the room held seat 0 still. */
  totalMs: number;
  totalRoomTicks: number;
}

/**
 * The stretches with no new frame at seat 0, between `fromT` (the drop) and
 * `toT` (live). A stretch runs from the sample where the newest tick last
 * rose (the first sample in the window counts as that moment) to the sample
 * where it rose again; one still open at `toT` is closed there.
 * Samples are `{ t, tick }` in time order, and `tick` never falls.
 */
export function frozenOf(samples: readonly TickSample[], fromT: number, toT: number, tickMs: number): Frozen {
  const inWindow = samples.filter((s) => s.t >= fromT && s.t <= toT);
  let longest = 0;
  let before = 0;
  let total = 0;
  if (inWindow.length > 0) {
    let lastRise = fromT;
    let prevTick = inWindow[0].tick;
    const close = (until: number): void => {
      const gap = until - lastRise;
      if (gap > longest) { longest = gap; before = prevTick; }
      if (gap > 3 * tickMs) total += gap;
    };
    for (const s of inWindow.slice(1)) {
      if (s.tick > prevTick) {
        close(s.t);
        lastRise = s.t;
        prevTick = s.tick;
      }
    }
    close(toT);
  }
  return {
    longestMs: longest,
    longestRoomTicks: Math.round(longest / tickMs),
    tickBeforeLongest: before,
    totalMs: total,
    totalRoomTicks: Math.round(total / tickMs),
  };
}

// ------------------------------------------------------------------- the run

const TAG = 'rejoin-measure';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MAP = 'tel_marum';
/** Fixed, so two runs play the same world. */
const SEED = 1000;
/** A browser that has not gone live this long after navigation is a failed measurement. */
const LIVE_TIMEOUT_MS = 10 * 60_000;
/** The warm-up boot's allowance (a cold Vite transform of the whole app). */
const WARM_TIMEOUT_MS = 3 * 60_000;

export interface RoomResult {
  mode: Mode;
  ticks: number;
  code: string;
  /** Why this room was not measured, else null. */
  skipped: string | null;
  seat0TickAtDrop: number | null;
  seat1TickAtDrop: number | null;
  boot: Phases | null;
  frozen: Frozen | null;
  /** The browser's `net()` as read at live. */
  browserNet: unknown;
  /** The rejoiner's first reading after boot. */
  firstSeen: { status: unknown; tickCount: number } | null;
  tickCountAtLive: number | null;
  /** Seat 0's counters when seat 1 dropped: the baseline. */
  seat0Stats: NetStats | null;
  /** Seat 0's counters again at live: the stall counts the freeze left (the plan's cross-check). */
  seat0StatsAtLive: NetStats | null;
  consoleErrors: string[];
  load: { start: number; end: number };
}

interface Room {
  code: string;
  ticks: number;
  tickets: [string, string];
  players: [RunningPlayer, RunningPlayer];
}

const log = (s: string): void => { process.stderr.write(`[${TAG}] ${s}\n`); };
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function post(relay: LocalRelay, path: string, body: unknown): Promise<Response> {
  return fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

/** A KDF v Sarim `tel_marum` room, real time, two scripted `rush` seats. */
async function openRoom(relay: LocalRelay, ticks: number, build: string): Promise<Room> {
  const created = await post(relay, '/api/match', { player: randomUUID(), callsign: 'Host', build, map: MAP, mode: 'versus', matchup: 'kdf' });
  if (created.status !== 201) throw new Error(`the room refused to open: HTTP ${created.status} ${await created.text()}`);
  const { code, ticket } = (await created.json()) as { code: string; ticket: string };
  const joined = await post(relay, `/api/match/${code}/join`, { player: randomUUID(), callsign: 'Guest' });
  if (joined.status !== 200) throw new Error(`the room refused the second seat: HTTP ${joined.status}`);
  const j = (await joined.json()) as { seat: unknown; ticket: string };
  if (j.seat !== 1) throw new Error(`the join answered seat ${String(j.seat)}, not 1`);
  const tickets: [string, string] = [ticket, j.ticket];
  const player = inProcess('rush', rush, { log: () => {} });
  const players: RunningPlayer[] = [];
  for (const seat of [0, 1] as const) {
    players.push(await player.start({ server: relay.url, origin: relay.origin, code, seat, ticket: tickets[seat], build }));
  }
  return { code, ticks, tickets, players: [players[0], players[1]] };
}

/** Resolves when seat 0 has run `ticks` frames, or says why it never will. */
async function reachTicks(room: Room): Promise<string | null> {
  const c0 = room.players[0].client;
  const c1 = room.players[1].client;
  if (c0 === null || c1 === null) return 'no in-process client';
  for (;;) {
    if (c0.tick() >= room.ticks && c1.tick() >= room.ticks - 40) return null;
    const r = c0.result() ?? c1.result();
    if (r !== null) return `the match ended at tick ${c0.tick()} before ${room.ticks} (${JSON.stringify(r)})`;
    const st = c0.transport.status();
    if (st.kind === 'closed' || st.kind === 'desync') return `seat 0 is ${st.kind} at tick ${c0.tick()}`;
    await sleep(20);
  }
}

interface Seen { status: { kind?: string; behind?: number } | null; tickCount: number | null }

/** One poll of the page: null when `__lions` is not there yet (or the page is between documents). */
async function readPage(page: Page): Promise<{ defined: boolean; seen: Seen | null; errors?: string }> {
  try {
    return await page.evaluate(() => {
      const l = (window as unknown as { __lions?: { net?: () => { status?: unknown; tickCount?: number } | null } }).__lions;
      if (l === undefined) return { defined: false, seen: null };
      const n = ((): { status?: unknown; tickCount?: number } | null => { try { return l.net?.() ?? null; } catch { return null; } })();
      return { defined: true, seen: n === null ? null : { status: (n.status ?? null) as Seen['status'], tickCount: n.tickCount ?? null } };
    });
  } catch {
    return { defined: false, seen: null };
  }
}

async function measureBrowserRejoin(ctx: BrowserContext, origin: string, room: Room, mode: Mode, tickMs: number): Promise<RoomResult> {
  const c0 = room.players[0].client;
  const c1 = room.players[1].client;
  if (c0 === null || c1 === null) throw new Error('no in-process client');
  const result: RoomResult = {
    mode, ticks: room.ticks, code: room.code, skipped: null, seat0TickAtDrop: null, seat1TickAtDrop: null,
    boot: null, frozen: null, browserNet: null, firstSeen: null, tickCountAtLive: null, seat0Stats: null, seat0StatsAtLive: null, consoleErrors: [],
    load: { start: loadavg()[0], end: loadavg()[0] },
  };
  const samples: TickSample[] = [];
  const sampler = setInterval(() => { samples.push({ t: Date.now(), tick: c0.tick() }); }, 10);
  result.seat0Stats = c0.transport.stats();
  // The reload: seat 1's tab goes with no `bye`.
  const dropAt = Date.now();
  result.seat0TickAtDrop = c0.tick();
  result.seat1TickAtDrop = c1.tick();
  samples.push({ t: dropAt, tick: c0.tick() });
  c1.transport.detach();
  const page = await ctx.newPage();
  try {
    page.on('console', (m) => { if (m.type() === 'error' && result.consoleErrors.length < 8) result.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => { if (result.consoleErrors.length < 8) result.consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`); });
    await page.addInitScript(`try { sessionStorage.setItem(${JSON.stringify(`lions.versus.seat.${room.code}`)}, ${JSON.stringify(JSON.stringify({ ticket: room.tickets[1], seat: 1 }))}); } catch (e) {}`);
    const tl: Timeline = { navAt: Date.now(), bootAt: null, liveAt: null };
    await page.goto(`${origin}/free-play/${MAP}?net=${room.code}&seat=1`, { waitUntil: 'commit' });
    while (tl.liveAt === null && Date.now() - tl.navAt < LIVE_TIMEOUT_MS) {
      const r = await readPage(page);
      const now = Date.now();
      if (r.defined && tl.bootAt === null) tl.bootAt = now;
      if (r.seen !== null) {
        if (result.firstSeen === null && r.seen.tickCount !== null) result.firstSeen = { status: r.seen.status, tickCount: r.seen.tickCount };
        const st = r.seen.status;
        if (st?.kind === 'live' && (st.behind ?? Infinity) <= 2 && (r.seen.tickCount ?? 0) >= (result.seat1TickAtDrop ?? 0)) {
          tl.liveAt = now;
          result.tickCountAtLive = r.seen.tickCount;
        }
      }
      if (tl.liveAt === null) await sleep(50);
    }
    result.load.end = loadavg()[0];
    result.boot = phases(tl);
    if (tl.liveAt === null) {
      result.skipped = `the browser was not live ${LIVE_TIMEOUT_MS / 1000} s after navigation (booted: ${tl.bootAt !== null})`;
    } else {
      result.frozen = frozenOf(samples, dropAt, tl.liveAt, tickMs);
      result.seat0StatsAtLive = c0.transport.stats();
      try {
        result.browserNet = await page.evaluate(() => (window as unknown as { __lions: { net: () => unknown } }).__lions.net());
      } catch { /* the instrument was optional */ }
    }
  } finally {
    clearInterval(sampler);
    await page.close().catch(() => {});
  }
  return result;
}

/** A page boot of the sandbox alone: warms Vite's transform and the browser's cache. */
async function warmUp(ctx: BrowserContext, origin: string): Promise<void> {
  const page = await ctx.newPage();
  try {
    const t0 = Date.now();
    await page.goto(`${origin}/free-play/${MAP}`, { waitUntil: 'commit' });
    for (;;) {
      if ((await readPage(page)).defined) break;
      if (Date.now() - t0 > WARM_TIMEOUT_MS) throw new Error(`the warm-up boot did not define __lions in ${WARM_TIMEOUT_MS / 1000} s`);
      await sleep(250);
    }
    log(`warm-up boot: ${Date.now() - t0} ms (cold)`);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Whether the unmasked renderer string (`readUnmaskedRenderer`) names Metal: the
 *  only GPU this instrument's numbers are meaningful on. SwiftShader, 'no-webgl'
 *  and 'no-debug-renderer-info' are all false. */
export function isMetalRenderer(gpu: string): boolean {
  return /\bmetal\b/i.test(gpu);
}

/** Seat 0's stall counts from its counters, e.g. `gone 1 (longest 1455 ms), behind 0 (longest 0 ms)`. */
export function stallSummary(stats: NetStats | null): string {
  if (stats === null) return 'not read';
  const g = stats.stalls.gone;
  const b = stats.stalls.behind;
  return `gone ${g.count} (longest ${Math.round(g.longestMs)} ms), behind ${b.count} (longest ${Math.round(b.longestMs)} ms)`;
}

export interface DevDeps<H> {
  /** `ensureDevServer`: the handle of a server it started, or null when one was already answering. */
  start(): Promise<H | null>;
  stop(h: H): void;
  isUp(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

/**
 * The dev server for the next mode: stop the last one THIS run started, wait for
 * its port to go quiet, start a fresh one. A start that comes back `null` means
 * something else is answering on the port, whose /api proxy points at the wrong
 * relay, so it is an error and never a `null` handle that would hide the leak.
 */
export async function restartDev<H>(prev: H | null, deps: DevDeps<H>, downTimeoutMs = 15_000): Promise<H> {
  if (prev !== null) {
    deps.stop(prev);
    const t0 = Date.now();
    while (await deps.isUp()) {
      if (Date.now() - t0 > downTimeoutMs) throw new Error(`the previous mode's dev server still answers ${downTimeoutMs / 1000} s after it was stopped`);
      await deps.sleep(200);
    }
  }
  const h = await deps.start();
  if (h === null) throw new Error('a dev server this run did not start is answering on the port; its /api proxy would point at the wrong relay');
  return h;
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** The table, one row a measured room. */
export function formatTable(rows: readonly RoomResult[], gpu: string, conditions: string): string {
  const lines = [`GPU: ${gpu}`, conditions, ''];
  for (const r of rows) {
    if (r.boot === null || r.frozen === null) {
      lines.push(`${r.mode} @ ${r.ticks}: NOT MEASURED -- ${r.skipped ?? 'no browser'}`);
      continue;
    }
    lines.push(
      `${r.mode} @ ${r.ticks} ticks (room ${r.code}, seat 0 at ${r.seat0TickAtDrop}, seat 1 at ${r.seat1TickAtDrop}):`,
      `  time to live ${r.boot.liveMs} ms   boot ${r.boot.bootMs} ms   replay phase ${r.boot.replayMs} ms`,
      `  frames replayed ${r.tickCountAtLive}   (first reading ${JSON.stringify(r.firstSeen)})`,
      `  opponent frozen: longest ${r.frozen.longestMs} ms (${r.frozen.longestRoomTicks} room ticks, newest tick before it ${r.frozen.tickBeforeLongest}), total ${r.frozen.totalMs} ms (${r.frozen.totalRoomTicks} room ticks)`,
      `  seat 0 stalls at live: ${stallSummary(r.seat0StatsAtLive)}   (at the drop: ${stallSummary(r.seat0Stats)})`,
      `  load average (1 min) ${f1(r.load.start)} -> ${f1(r.load.end)}`,
    );
  }
  return lines.join('\n');
}

export async function run(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if ('error' in args) { process.stderr.write(`${args.error}\n`); return 2; }
  const port = args.browser ? await claimPort(TAG, 'REJOIN_MEASURE_PORT', 5251) : 0;
  const build = buildId();
  const origin = `http://localhost:${port}`;
  const results: RoomResult[] = [];
  let browser: Browser | null = null;
  let ctx: BrowserContext | null = null;
  let gpu = 'none (--no-browser)';
  const relays: LocalRelay[] = [];
  const rooms: Room[] = [];
  let dev: Awaited<ReturnType<typeof ensureDevServer>> = null;
  let code = 0;
  const cleanup = async (): Promise<void> => {
    for (const room of rooms) for (const p of room.players) p.client?.transport.detach();
    await ctx?.close().catch(() => {});
    await browser?.close().catch(() => {});
    stopDevServer(dev, TAG);
    dev = null;
    for (const r of relays) await r.close().catch(() => {});
  };
  const onSignal = (): void => { void cleanup().finally(() => process.exit(130)); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    if (args.browser) {
      browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
      gpu = await readUnmaskedRenderer(browser);
      log(`GPU: ${gpu}`);
      if (!isMetalRenderer(gpu)) throw new Error(`the unmasked renderer is "${gpu}", not Metal: this instrument is only meaningful on the GPU`);
      ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.addInitScript(musicOffInitScript());
    }
    for (const mode of args.modes) {
      const relay = await startLocalRelay({
        tickMs: args.tickMs,
        seedFor: () => SEED,
        snapshotEveryTicks: mode === 'off' ? 0 : undefined,
        extraOrigins: args.browser ? [origin, `http://127.0.0.1:${port}`] : [],
        log: () => {},
      });
      relays.push(relay);
      if (args.browser && ctx !== null) {
        process.env.LIONS_API_TARGET = relay.url;
        // One dev server a mode: its /api proxy is read once, at start, so a server
        // left from the last mode would still point at that mode's relay.
        dev = await restartDev(dev, {
          start: () => ensureDevServer(port, REPO, TAG),
          stop: (h) => stopDevServer(h, TAG),
          isUp: async () => { try { return (await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) })).status < 500; } catch { return false; } },
          sleep,
        });
        await warmUp(ctx, origin);
      }
      log(`mode ${mode}: relay ${relay.url}, build ${build}; pre-playing ${args.ticks.join(', ')} ticks at ${args.tickMs} ms`);
      const mine: Room[] = [];
      for (const ticks of args.ticks) {
        const room = await openRoom(relay, ticks, build);
        rooms.push(room);
        mine.push(room);
      }
      // Each room is measured when it gets there, the earliest first; the rest keep pre-playing.
      for (const room of mine) {
        const why = await reachTicks(room);
        const c0 = room.players[0].client;
        if (why !== null || c0 === null) {
          log(`room ${room.code} @ ${room.ticks}: ${why ?? 'no client'}`);
          results.push({ mode, ticks: room.ticks, code: room.code, skipped: why, seat0TickAtDrop: c0?.tick() ?? null, seat1TickAtDrop: null, boot: null, frozen: null, browserNet: null, firstSeen: null, tickCountAtLive: null, seat0Stats: null, seat0StatsAtLive: null, consoleErrors: [], load: { start: loadavg()[0], end: loadavg()[0] } });
          continue;
        }
        if (ctx === null) {
          log(`room ${room.code} reached tick ${c0.tick()} (--no-browser: not measured)`);
          results.push({ mode, ticks: room.ticks, code: room.code, skipped: 'no browser', seat0TickAtDrop: c0.tick(), seat1TickAtDrop: room.players[1].client?.tick() ?? null, boot: null, frozen: null, browserNet: null, firstSeen: null, tickCountAtLive: null, seat0Stats: c0.transport.stats(), seat0StatsAtLive: null, consoleErrors: [], load: { start: loadavg()[0], end: loadavg()[0] } });
          continue;
        }
        log(`room ${room.code} reached ${room.ticks}: reloading seat 1 in the browser`);
        const r = await measureBrowserRejoin(ctx, origin, room, mode, args.tickMs);
        results.push(r);
        // This room is done: seat 0 leaves quietly so the room stops costing Node time.
        for (const p of room.players) p.client?.transport.detach();
      }
    }
    const conditions = !args.browser ? `no browser; ${args.tickMs} ms room tick, ${process.platform}/${process.arch}` : `Chromium headless (Playwright), ANGLE/Metal, 1280x720 viewport, warm dev server of ${build}, ${args.tickMs} ms room tick, `
      + `${process.platform}/${process.arch}, load average at the end ${f1(loadavg()[0])}; the later rooms kept pre-playing in Node during an earlier room's measurement`;
    const table = formatTable(results, gpu, conditions);
    process.stdout.write(`${table}\n`);
    const outFile = resolve(args.out ?? join(tmpdir(), 'lions-rejoin-measure', `rejoin-measure-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, `${JSON.stringify({ gpu, conditions, build, args, results }, null, 2)}\n`);
    log(`wrote ${outFile}`);
    if (results.some((r) => r.skipped !== null && r.skipped !== 'no browser')) code = 1;
  } catch (e) {
    process.stderr.write(`${TAG}: ${messageOf(e)}\n`);
    code = 1;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await cleanup();
  }
  return code;
}

/** Whether this module is the process's entry point (and not imported by a spec). */
function isEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}
if (isEntry()) {
  void run(process.argv.slice(2)).then((c) => { process.exit(c); });
}
