/**
 * `pnpm net:budget` (GH-913 L8): a headless match of the map's own length through the local relay (the real Worker
 * routes and the real `MatchRoom` over the fake Durable Object, loopback only: no D1, no deploy, no remote
 * anything), recording what the network budget of design section 4 is made of -- rows written, command-log
 * characters, snapshot sizes -- and judging them against that section's bounds.
 *
 *   pnpm net:budget -- [--map=rujm_sawda] [--play=heavy|idle|rush] [--cap-ticks=<the map's cap>] [--pace=40]
 *                      [--tick-ms=2] [--snapshot-every=1200] [--ids=30] [--per-round=4] [--out=<file.json>]
 *
 * Plays: `idle` orders nothing (two forces standing to the cap: the cap rule decides on time, the match runs the
 * whole length); `heavy` re-orders the home force with `--per-round` moves of `--ids` units every round (the
 * design's heavy pair: 120 orders a minute a seat of 30 ids, with the defaults pace 40 -> 2 s rounds -> 4 a round),
 * kept near home so the match is not decided early; `rush` is `players.ts`'s control, a real battle that ends when
 * it ends (reported, not judged against the cap).
 *
 * Both seats are `human` kind in a paced room (a bot seat produces no snapshot, #855) and produce snapshots on the
 * room's cadence. Rows are counted by category by wrapping the fake storage's three write paths.
 *
 * Wall time is NOT game time here (`--tick-ms` 2, paced rounds), so the one wall-clock row source, the watchdog
 * alarm (`WATCHDOG_MS`, re-armed every 5 s), is reported as measured AND as the real-time figure, with the
 * game's own seconds in place of the wall seconds. NEVER RUNS IN CI: a 35-minute match is 42,000 ticks in two sims.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { SNAPSHOT_MAX_COMPRESSED_BYTES, SNAPSHOT_MAX_RAW_BYTES, matchCapMinutesOf, matchCapTicksOf, maxLogCmdChars, type CapConfig } from '@lions/net';
import type { Command } from '@lions/sim';
import { MAX_LOG_CMD_CHARS } from '../../../packages/worker/src/match/room-core';
import type { FakeState } from '../../../packages/worker/src/match/fake-do';
import { buildId } from './build-id';
import { capOutcome } from './cap';
import { startLocalRelay, type LocalRelay } from './local-relay';
import { inProcess, passive, rush, type ArenaPlayer, type Policy, type RunningPlayer } from './players';
import { encodeSim } from '../../../packages/sim/src/snapshot';
import { fx } from '@lions/sim';

// ---------------------------------------------------------------- pure parts

/** Rows a match of `seconds` game seconds costs in the design's model (section 4, `match-room.ts`): 72 a minute
 *  idle -- one batch a second, the watchdog every 5 s, the rest lifecycle -- and 132 a minute at one order a second
 *  a seat, plus one a minute for the snapshot row. The bounds the measurement is judged against. */
export const ROWS_PER_MIN_IDLE = 72;
export const ROWS_PER_MIN_BUSY = 132;
export const SNAPSHOT_ROWS_PER_MIN = 1;
/** Design section 4's 35-minute row: 2,555 idle to 4,655 busy. */
export function rowBounds(minutes: number): { idle: number; busy: number } {
  return { idle: (ROWS_PER_MIN_IDLE + SNAPSHOT_ROWS_PER_MIN) * minutes, busy: (ROWS_PER_MIN_BUSY + SNAPSHOT_ROWS_PER_MIN) * minutes };
}

/** The watchdog's re-arm period in wall milliseconds (match-room.ts), the one row source that follows wall time. */
export const WATCHDOG_MS = 5000;

export interface Measured {
  map: string;
  /** The room's mode and set-up flag, when it has them (GH-976 R0.8). This harness opens an annihilation room, so they are
   *  absent; they are here so the cap is always read through `matchCapTicksOf` and never from the map alone. */
  winMode?: CapConfig['winMode'];
  flagSetup?: CapConfig['flagSetup'];
  capTicks: number;
  /** The tick the match was read at (the end of the run). */
  ticks: number;
  /** `rowsWritten` by category, as measured. */
  rows: { total: number; batch: number; snapshot: number; alarm: number; state: number };
  /** Wall seconds the match took and the alarm re-arms in them (so the real-time watchdog figure can be derived). */
  wallSeconds: number;
  /** Command JSON characters stamped into frames (what `MAX_LOG_CMD_CHARS` counts) and commands. */
  cmdChars: number;
  commands: number;
  /** Characters of every stored batch (frames with empty arrays included). */
  storedChars: number;
  /** The newest snapshot the room holds, null when it holds none. */
  snapshot: { tick: number; bytes: number } | null;
  /** Every snapshot size the producer wrote over the match, bytes (compressed, as uploaded). */
  snapshotSizes: number[];
  /** The end of the match, in raw and gzip bytes, encoded by this tool from the reading seat's own world. */
  endSnapshot: { raw: number; gzip: number } | null;
  /** The match's result at the end, as the reading seat's rule gave it. */
  result: string;
  /** What the policies were asked and answered, both seats: calls, orders returned, own units seen (summed). */
  policy: { calls: number; orders: number; units: number };
  /** The first few errors each player reported (an order the desk refused, a policy that threw). */
  playerErrors: string[];
}

/** The cap-bearing slice of a measured room. */
const roomOf = (m: Pick<Measured, 'map' | 'winMode' | 'flagSetup'>): CapConfig => ({ map: m.map, winMode: m.winMode, flagSetup: m.flagSetup });

/** The watchdog rows a REAL-TIME match of `gameSeconds` costs: one a re-arm, every 5 s. */
export function watchdogRowsReal(gameSeconds: number): number {
  return Math.ceil((gameSeconds * 1000) / WATCHDOG_MS);
}

/** The match's rows at real-time pacing: the measured rows with the wall-clock alarm rows swapped for the ones a
 *  real-time match of the same game length would write. */
export function realTimeRows(m: Measured): number {
  return m.rows.total - m.rows.alarm + watchdogRowsReal(m.ticks / 20);
}

export interface Verdict { ok: boolean; failures: string[]; lines: string[] }

/** Judges a measurement against design section 4 for the map's own cap. A failed line names the number. */
export function judge(m: Measured, play: { heavy: boolean; mayEndEarly?: boolean }): Verdict {
  const failures: string[] = [];
  const lines: string[] = [];
  const minutes = matchCapMinutesOf(roomOf(m));
  const real = realTimeRows(m);
  const bounds = rowBounds(minutes);
  lines.push(`rows at real-time pacing: ${real} (measured ${m.rows.total}, of which wall-clock alarm ${m.rows.alarm}); section 4 bound ${bounds.idle}..${bounds.busy}`);
  if (real > bounds.busy) failures.push(`rows ${real} exceed the busy bound ${bounds.busy}`);
  const cap = maxLogCmdChars(roomOf(m), MAX_LOG_CMD_CHARS);
  lines.push(`command-log characters: ${m.cmdChars} of ${cap} (${((100 * m.cmdChars) / cap).toFixed(1)}%), ${m.commands} commands, stored frame JSON ${m.storedChars}`);
  if (m.cmdChars > cap) failures.push(`command characters ${m.cmdChars} exceed the cap ${cap}`);
  if (m.cmdChars > 0.9 * cap) failures.push(`command characters ${m.cmdChars} are over 90% of the cap ${cap}`);
  if (m.snapshot !== null) {
    lines.push(`snapshot held: tick ${m.snapshot.tick}, ${m.snapshot.bytes} B gzip (cap ${SNAPSHOT_MAX_COMPRESSED_BYTES}); largest uploaded ${Math.max(0, ...m.snapshotSizes)} B over ${m.snapshotSizes.length} uploads`);
    if (Math.max(0, ...m.snapshotSizes) > SNAPSHOT_MAX_COMPRESSED_BYTES) failures.push('a snapshot upload exceeded the compressed cap');
  } else {
    lines.push('snapshot held: none');
  }
  if (m.endSnapshot !== null) {
    lines.push(`end-of-match world encoded: ${m.endSnapshot.raw} B raw, ${m.endSnapshot.gzip} B gzip (caps ${SNAPSHOT_MAX_RAW_BYTES} raw, ${SNAPSHOT_MAX_COMPRESSED_BYTES} compressed)`);
    if (m.endSnapshot.raw > SNAPSHOT_MAX_RAW_BYTES) failures.push(`end snapshot raw ${m.endSnapshot.raw} exceeds ${SNAPSHOT_MAX_RAW_BYTES}`);
    if (m.endSnapshot.gzip > SNAPSHOT_MAX_COMPRESSED_BYTES) failures.push(`end snapshot gzip ${m.endSnapshot.gzip} exceeds ${SNAPSHOT_MAX_COMPRESSED_BYTES}`);
  }
  if (play.heavy && m.commands === 0) failures.push('the heavy play sent no commands, so the log cap was not exercised');
  const full = m.capTicks === matchCapTicksOf(roomOf(m)) && play.mayEndEarly !== true;
  if (full) {
    if (m.ticks !== m.capTicks) failures.push(`the match ran to tick ${m.ticks}, not its cap ${m.capTicks}`);
    if (!m.result.includes('time')) failures.push(`at the cap the result is "${m.result}", not a decision on time`);
  }
  return { ok: failures.length === 0, failures, lines };
}

/** Stored-frame statistics from the batch table: every frame's commands and their JSON characters. */
export function logStats(batches: ReadonlyMap<number, string>): { cmdChars: number; commands: number; storedChars: number } {
  let cmdChars = 0;
  let commands = 0;
  let storedChars = 0;
  for (const frames of batches.values()) {
    storedChars += frames.length;
    for (const f of JSON.parse(frames) as { cmds: { cmd: unknown }[] }[]) {
      for (const c of f.cmds) {
        commands++;
        cmdChars += JSON.stringify(c.cmd).length;
      }
    }
  }
  return { cmdChars, commands, storedChars };
}

/** The `heavy` policy: `perRound` moves of up to `ids` of this seat's own units to a tile near home, a different
 *  tile each time, so every command differs and none walks into the enemy. */
export function heavyPolicy(ids: number, perRound: number): Policy {
  let n = 0;
  return (view) => {
    const mine = view.units.map((u) => u.id);
    if (mine.length === 0) return [];
    const out: Command[] = [];
    for (let k = 0; k < perRound; k++) {
      const take: number[] = [];
      for (let i = 0; i < Math.min(ids, mine.length); i++) take.push(mine[(n + i) % mine.length]);
      const a = (n * 7 + k) % 9;
      const tx = Math.max(1, view.camp[0] + 3 + (a % 3) * 2);
      const ty = Math.max(1, view.camp[1] + 3 + Math.floor(a / 3) * 2);
      out.push({ kind: 'move', ids: take, x: fx.from(tx + 0.5), y: fx.from(ty + 0.5) });
      n++;
    }
    return out;
  };
}

// ------------------------------------------------------------------- the run

export interface Args {
  map: string;
  play: 'heavy' | 'idle' | 'rush';
  capTicks: number;
  pace: number;
  tickMs: number;
  snapshotEvery: number;
  ids: number;
  perRound: number;
  out: string | null;
}

export function parseArgs(argv: readonly string[]): Args | { error: string } {
  const got = new Map<string, string>();
  for (const arg of argv) {
    if (arg === '--') continue;
    const m = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (m === null) return { error: `unexpected argument "${arg}"` };
    got.set(m[1], m[2]);
  }
  const num = (k: string, d: number): number => (got.has(k) ? Number(got.get(k)) : d);
  const map = got.get('map') ?? 'rujm_sawda';
  const play = got.get('play') ?? 'heavy';
  if (play !== 'heavy' && play !== 'idle' && play !== 'rush') return { error: '--play is heavy, idle or rush' };
  const a: Args = {
    map, play, capTicks: num('cap-ticks', matchCapTicksOf({ map })), pace: num('pace', 40), tickMs: num('tick-ms', 2),
    snapshotEvery: num('snapshot-every', 1200), ids: num('ids', 30), perRound: num('per-round', 4), out: got.get('out') ?? null,
  };
  for (const [k, v] of Object.entries(a)) if (typeof v === 'number' && (!Number.isInteger(v) || v < 0)) return { error: `--${k} is a whole number` };
  if (a.pace < 20 || a.pace > 1200) return { error: '--pace is 20-1200' };
  return a;
}

async function post(relay: LocalRelay, path: string, body: unknown): Promise<Response> {
  return fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

/** Wraps the fake storage's write paths to count rows by category. */
export function countRows(state: FakeState): { read(): Measured['rows'] } {
  const s = state.storage as unknown as {
    rowsWritten: number;
    put: (k: string, v: unknown) => Promise<void>;
    setAlarm: (t: number) => Promise<void>;
    sql: { exec: (q: string, ...b: unknown[]) => unknown };
  };
  const c = { batch: 0, snapshot: 0, alarm: 0, state: 0 };
  const put = s.put.bind(s);
  s.put = async (k, v) => { c.state++; await put(k, v); };
  const setAlarm = s.setAlarm.bind(s);
  s.setAlarm = async (t) => { c.alarm++; await setAlarm(t); };
  const exec = s.sql.exec.bind(s.sql);
  s.sql.exec = (q, ...b) => {
    const before = s.rowsWritten;
    const r = exec(q, ...b);
    const d = s.rowsWritten - before;
    if (d > 0) { if (/snapshot/i.test(q)) c.snapshot += d; else c.batch += d; }
    return r;
  };
  return { read: () => ({ total: s.rowsWritten, ...c }) };
}

export async function measure(a: Args, log: (line: string) => void, policyOf?: (base: Policy) => Policy): Promise<{ m: Measured; verdict: Verdict }> {
  const relay = await startLocalRelay({ tickMs: a.tickMs, snapshotEveryTicks: a.snapshotEvery, log });
  const build = buildId();
  const running: RunningPlayer[] = [];
  const started = Date.now();
  try {
    const pace = { kind: 'paced', roundTicks: a.pace, roundWallMs: 120_000 };
    const created = await post(relay, '/api/match', { player: randomUUID(), callsign: 'budget-a', build, map: a.map, mode: 'versus', matchup: 'mirror', pace });
    if (created.status !== 201) throw new Error(`the room refused to open: HTTP ${created.status} ${await created.text()}`);
    const { code, ticket } = (await created.json()) as { code: string; ticket: string };
    const joined = await post(relay, `/api/match/${code}/join`, { player: randomUUID(), callsign: 'budget-b' });
    if (joined.status !== 200) throw new Error(`the room refused the second seat: HTTP ${joined.status}`);
    const j = (await joined.json()) as { ticket: string };
    const state = relay.stateOf(code);
    if (state === undefined) throw new Error('the relay holds no state for the room');
    const counter = countRows(state);
    const base: Policy = a.play === 'rush' ? rush : a.play === 'idle' ? passive : heavyPolicy(a.ids, a.perRound);
    const wrapped = policyOf === undefined ? base : policyOf(base);
    const asked = { calls: 0, orders: 0, units: 0 };
    const policy: Policy = async (view) => {
      const out = await wrapped(view);
      asked.calls++;
      asked.orders += out.length;
      asked.units += view.units.length;
      return out;
    };
    const snapshotSizes: number[] = [];
    const player: ArenaPlayer = inProcess(a.play, policy, { log, snapshots: { produce: true } });
    for (const seat of [0, 1] as const) {
      running.push(await player.start({ server: relay.url, origin: relay.origin, code, seat, ticket: seat === 0 ? ticket : j.ticket, build, capTicks: a.capTicks }));
    }
    const sampler = setInterval(() => {
      const row = (state.storage as unknown as { snapshotRow: { bytes: ArrayBuffer; frame_tick: number } | null }).snapshotRow;
      if (row !== null && snapshotSizes[snapshotSizes.length - 1] !== row.bytes.byteLength) snapshotSizes.push(row.bytes.byteLength);
    }, 50);
    const budgetMs = (Math.ceil(a.capTicks / a.pace) + 2) * 120_000 + 60_000;
    const reports = await Promise.race([
      Promise.all(running.map((r) => r.done)),
      new Promise<never>((_, rej) => setTimeout(() => { rej(new Error(`the match did not finish in ${budgetMs} ms`)); }, budgetMs)),
    ]);
    clearInterval(sampler);
    const client = running[0].client;
    const w = client?.world();
    if (client === null || w === null || w === undefined) throw new Error('the reading seat never built its world');
    const ticks = client.tick();
    const raw = encodeSim(w.sim, { frameTick: ticks - 1 }, w.runtime ?? undefined);
    const result = client.result();
    const verdictText = result !== null
      ? (result.kind === 'draw' ? `draw (${result.by})` : `side ${result.side} won (${result.by})`)
      : (() => { const o = capOutcome(w.sim, undefined, { map: a.map }); return o.kind === 'draw' ? `draw (${o.by}, read at the cap)` : `side ${o.side} won (${o.by}, read at the cap)`; })();
    const row = (state.storage as unknown as { snapshotRow: { bytes: ArrayBuffer; frame_tick: number } | null }).snapshotRow;
    const stats = logStats(state.storage.batches);
    const m: Measured = {
      map: a.map, capTicks: a.capTicks, ticks,
      rows: counter.read(),
      wallSeconds: (Date.now() - started) / 1000,
      ...stats,
      snapshot: row === null ? null : { tick: row.frame_tick, bytes: row.bytes.byteLength },
      snapshotSizes,
      endSnapshot: { raw: raw.length, gzip: gzipSync(raw).length },
      result: verdictText,
      policy: asked,
      playerErrors: reports.flatMap((r, seat) => r.errors.slice(0, 4).map((e) => `seat ${seat}: ${e}`)),
    };
    return { m, verdict: judge(m, { heavy: a.play === 'heavy', mayEndEarly: a.play === 'rush' }) };
  } finally {
    for (const r of running) { try { await r.stop(); } catch { /* the next close still runs */ } }
    await relay.close();
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) { process.stderr.write(`${parsed.error}\n`); return 2; }
  const log = (line: string): void => { process.stderr.write(`${line}\n`); };
  const { m, verdict } = await measure(parsed, log);
  const out = parsed.out ?? join(tmpdir(), `net-budget-${parsed.map}-${parsed.play}.json`);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ args: parsed, measured: m, realTimeRows: realTimeRows(m), verdict }, null, 2)}\n`);
  process.stdout.write(`net:budget ${parsed.map} ${parsed.play}: ${m.ticks} ticks (${(m.ticks / 1200).toFixed(1)} min), ${m.wallSeconds.toFixed(0)} s wall, result ${m.result}\n`);
  for (const l of verdict.lines) process.stdout.write(`  ${l}\n`);
  process.stdout.write(`  rows by kind: ${JSON.stringify(m.rows)}\n`);
  process.stdout.write(`  policy: ${m.policy.calls} calls, ${m.policy.orders} orders returned, ${(m.policy.units / Math.max(1, m.policy.calls)).toFixed(1)} own units seen a call\n`);
  for (const e of m.playerErrors) process.stdout.write(`  player: ${e}\n`);
  for (const f of verdict.failures) process.stdout.write(`  FAIL: ${f}\n`);
  process.stdout.write(`  written to ${out}\n`);
  return verdict.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((c) => { process.exit(c); }, (e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exit(2); });
}
