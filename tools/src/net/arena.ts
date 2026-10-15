/**
 * `pnpm arena` (N4b task 13, decision D7): two players, each seed played
 * twice with the seats swapped, on the local relay -- the real Worker routes
 * and the real `MatchRoom` on 127.0.0.1, one relay per game, nothing billed
 * and nothing beyond loopback.
 *
 *   pnpm arena -- --a rush --b passive --seeds 10 --map tel_marum [--matchup mirror|kdf|sarim]
 *                 [--pace 60] [--round-wall-ms 120000] [--cap-ticks 12000] [--tick-ms 2] [--out arena-results/]
 *
 * A player is `passive` or `rush` (decision D8's controls), or
 * `cmd:<template>` (Task 14, `external-player.ts`): a process per game -- a
 * model's client -- that drives `pnpm agent` over MCP, its output in
 * `<out>/<game>-<seat>.log`. Seed n is `1000 + 7919 n`, the versus probe's sequence:
 * game 1 has A on seat 0, game 2 has B there. The arena plays only what a
 * room offers (`versusMapAllowed`, `matchupAllowed`), and trusts a run only
 * once the room's start config says the pace, seed, map and factions it asked
 * for: a malformed pace is silently realtime, and a realtime result is no
 * result here. At `--cap-ticks` both players stop on their own and the game
 * is decided by `capOutcome` on the reading seat's sim (ruling N1: seat 0's
 * when it runs in this process, else seat 1's, else the observer's), recorded `by: 'cap'`.
 * The arena reads a game through a seat that runs in this process; when
 * neither does (`cmd` vs `cmd`), through an OBSERVER: seat 0's own advisor
 * (`advise` scope, minted from seat 0's ticket by the room's advisor route),
 * which keeps its own sim in step from the frames every socket receives and
 * sends nothing that touches the match.
 * A game whose two sims report different results, or whose room sends
 * `desync`, is `void`.
 *
 * Writes `<out>/<date>-<a>-vs-<b>.jsonl` (one `GameRecord` a line, appended
 * as each game ends) and `.md` (`markdownReport`); `--out` defaults to
 * `arena-results/` under the directory pnpm was run from (`INIT_CWD`), and
 * nothing is ever written outside it. stdout carries the files written and
 * the tally; every log line goes to stderr.
 *
 * Exit codes: 0 every game played (voids included: a void is a result of the
 * arena, not a failure of it); 1 a bad command line, a player that cannot be
 * built, or a game that could not be played (a relay, a room or a start
 * config the arena could not trust); 2 a map or matchup no room offers,
 * refused before any room exists.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MATCHUPS, factionsOfMatchup, matchupAllowed, versusMapAllowed, type MatchConfig, type Matchup, type TransportStatus } from '@lions/net';
import { MATCH_CAP_TICKS, type MatchResult, type OutcomeSim } from '../../../packages/app/src/net/outcome';
import { scoreOf } from '../../../packages/app/src/net/scoreboard';
import { AgentClient } from './agent-client';
import { markdownReport, tally, type GameRecord, type Tally } from './arena-score';
import { buildId } from './build-id';
import { capOutcome } from './cap';
import { startLocalRelay, type LocalRelay, type LocalRelayOptions } from './local-relay';
import { externalPlayer } from './external-player';
import { inProcess, passive, rush, type ArenaPlayer, type PlayerReport, type RunningPlayer } from './players';

export interface ArenaArgs {
  /** Player specs: `passive`, `rush`, or `cmd:<template>` (Task 14). */
  a: string;
  b: string;
  seeds: number;
  map: string;
  matchup: Matchup;
  /** Ticks a paced round (the room clamps to 20-1,200, D5: refused outside that here). */
  pace: number;
  roundWallMs: number;
  capTicks: number;
  /** The relay rooms' clock period. */
  tickMs: number;
  /** null: `arena-results/` under the invoking directory. */
  out: string | null;
}

const USAGE = 'usage: pnpm arena -- --a <player> --b <player> [--seeds 10] [--map tel_marum] [--matchup mirror|kdf|sarim] [--pace 60] [--round-wall-ms 120000] [--cap-ticks 12000] [--tick-ms 2] [--out arena-results/]\n  a player is passive, rush, or cmd:<template>';
const VALUED = new Set(['a', 'b', 'seeds', 'map', 'matchup', 'pace', 'round-wall-ms', 'cap-ticks', 'tick-ms', 'out']);
const BUILT_IN: Record<string, (log: (line: string) => void) => ArenaPlayer> = {
  passive: (log) => inProcess('passive', passive, { log }),
  rush: (log) => inProcess('rush', rush, { log }),
};
const EXTERNAL = /^cmd:./s;

/** The versus probe's seed sequence (`versus-probe.ts` `seedOf`). */
export const seedOf = (n: number): number => 1000 + n * 7919;

/** An integer option inside [lo, hi], or what is wrong with it. */
function intIn(name: string, v: string | undefined, def: number, lo: number, hi: number): number | { error: string } {
  if (v === undefined) return def;
  if (!/^\d+$/.test(v)) return { error: `--${name} is a whole number` };
  const n = Number(v);
  if (n < lo || n > hi) return { error: `--${name} is ${lo}-${hi}` };
  return n;
}

/** The command line, or what is wrong with it. Whether the map and matchup
 *  are offered is `refusalOf`'s question (exit 2), not a parse error. */
export function parseArgs(argv: readonly string[]): ArenaArgs | { error: string } {
  const got = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;   // pnpm passes the separator through
    if (!arg.startsWith('--')) return { error: `unexpected argument "${arg}"\n${USAGE}` };
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    if (!VALUED.has(name)) return { error: `unknown option --${name}\n${USAGE}` };
    let value: string | undefined;
    if (eq >= 0) value = arg.slice(eq + 1);
    else { value = argv[i + 1]; i++; }
    if (value === undefined || value === '') return { error: `--${name} needs a value` };
    got.set(name, value);
  }
  const a = got.get('a');
  const b = got.get('b');
  if (a === undefined || b === undefined) return { error: `--a and --b are required\n${USAGE}` };
  for (const p of [a, b]) {
    if (!(p in BUILT_IN) && !EXTERNAL.test(p)) return { error: `unknown player "${p}": passive, rush, or cmd:<template>` };
  }
  const matchup = got.get('matchup') ?? 'mirror';
  if (!(MATCHUPS as readonly string[]).includes(matchup)) return { error: `--matchup is ${MATCHUPS.join(', ')}` };
  const seeds = intIn('seeds', got.get('seeds'), 10, 1, 10_000);
  const pace = intIn('pace', got.get('pace'), 60, 20, 1200);
  const roundWallMs = intIn('round-wall-ms', got.get('round-wall-ms'), 120_000, 1000, 600_000);
  const capTicks = intIn('cap-ticks', got.get('cap-ticks'), 12_000, 1, MATCH_CAP_TICKS);
  const tickMs = intIn('tick-ms', got.get('tick-ms'), 2, 1, 1000);
  for (const v of [seeds, pace, roundWallMs, capTicks, tickMs]) if (typeof v !== 'number') return v;
  return {
    a, b,
    seeds: seeds as number,
    map: got.get('map') ?? 'tel_marum',
    matchup: matchup as Matchup,
    pace: pace as number,
    roundWallMs: roundWallMs as number,
    capTicks: capTicks as number,
    tickMs: tickMs as number,
    out: got.get('out') ?? null,
  };
}

/** Why no room would host this, or null: the route's own two questions. */
export function refusalOf(map: string, matchup: Matchup): string | null {
  if (!versusMapAllowed(map)) return `no versus room is offered on ${map}`;
  if (!matchupAllowed(matchup, map)) return `the ${matchup} matchup is not offered on ${map} (mirror only)`;
  return null;
}

/** The player a spec names. A `cmd:` template that cannot be run (an open
 *  quote, a placeholder that is not one) throws here, before any room. */
export function resolvePlayer(spec: string, log: (line: string) => void): ArenaPlayer {
  const make = BUILT_IN[spec] as ((log: (line: string) => void) => ArenaPlayer) | undefined;
  if (make !== undefined) return make(log);
  if (EXTERNAL.test(spec)) return externalPlayer(spec, spec);
  throw new Error(`unknown player "${spec}"`);
}

export interface ArenaDeps {
  /** stderr by default. */
  log?: (line: string) => void;
  /** stdout by default: the files written and the tally. */
  print?: (line: string) => void;
  /** The local relay, per game. */
  startRelay?: (o: LocalRelayOptions) => Promise<LocalRelay>;
  /** The player a spec names; default `resolvePlayer`. */
  resolvePlayer?: (spec: string, log: (line: string) => void) => ArenaPlayer;
  /** The reader for a game with no in-process seat; default `startObserver`. */
  startObserver?: typeof startObserver;
  now?: () => Date;
}

export interface ArenaRun {
  code: number;
  games: GameRecord[];
  tally: Map<string, Tally> | null;
  files: { jsonl: string; md: string } | null;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** A name that is safe in a file name. */
const fileSafe = (s: string): string => s.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 40) || 'player';

/** How long a start may take before the arena gives up on the room. */
const START_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => { timer = setTimeout(() => { rej(new Error(`${what}: nothing in ${ms} ms`)); }, ms); }),
  ]).finally(() => { if (timer !== null) clearTimeout(timer); });
}

async function post(relay: LocalRelay, path: string, body: unknown): Promise<Response> {
  return fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

/** A paced versus room with two bot seats, through the relay's own routes. */
async function openRoom(relay: LocalRelay, a: ArenaArgs, build: string, names: [string, string]): Promise<{ code: string; tickets: [string, string] }> {
  const pace = { kind: 'paced', roundTicks: a.pace, roundWallMs: a.roundWallMs };
  const created = await post(relay, '/api/match', { player: randomUUID(), callsign: names[0].slice(0, 16), build, map: a.map, mode: 'versus', matchup: a.matchup, kind: 'bot', pace });
  if (created.status !== 201) throw new Error(`the room refused to open: HTTP ${created.status} ${await created.text()}`);
  const { code, ticket } = (await created.json()) as { code: string; ticket: string };
  const joined = await post(relay, `/api/match/${code}/join`, { player: randomUUID(), callsign: names[1].slice(0, 16), kind: 'bot' });
  if (joined.status !== 200) throw new Error(`the room refused the second seat: HTTP ${joined.status}`);
  const j = (await joined.json()) as { seat: unknown; ticket: string };
  if (j.seat !== 1) throw new Error(`the join answered seat ${String(j.seat)}, not 1`);
  return { code, tickets: [ticket, j.ticket] };
}

/** The seat whose side a result names. */
const seatOfSide = (sides: readonly [0 | 1, 0 | 1], side: 0 | 1): 0 | 1 => (sides[0] === side ? 0 : 1);

/** The room's own endings, which the seat that gave up never hears. */
const ROOM_ENDINGS: readonly string[] = ['forfeit', 'surrender', 'left'];

/** What `judge` reads of one seat: a SNAPSHOT, taken once both players have
 *  finished and BEFORE the arena stops them. Stopping a player closes its
 *  transport, which overwrites the room's last word (`desync`, the reason an
 *  ended room gave) with `left`/`detached`; read afterwards, that word is gone. */
export interface SeatSnapshot {
  result: MatchResult | null;
  tick: number;
  status: TransportStatus;
  sim: OutcomeSim | null;
}

/** A seat's client as it stands now. Call before `stop()`. */
export function snapshotOf(c: AgentClient): SeatSnapshot {
  return { result: c.result(), tick: c.tick(), status: c.transport.status(), sim: c.world()?.sim ?? null };
}

/** The record's outcome from the seats' snapshots (null for a player not in
 *  this process). A desync the room sent to either seat is `void`/`desync`;
 *  two sims reporting different results are `void`/`disagree`; two seats with
 *  no result, both standing on the cap tick, are decided by `capOutcome` on
 *  the reading seat's sim (seat 0's, else seat 1's, which is also the observer's
 *  when neither runs here) and recorded `by: 'cap'`. */
export function judge(
  seats: readonly [SeatSnapshot | null, SeatSnapshot | null],
  sides: readonly [0 | 1, 0 | 1],
  capTicks: number,
): { outcome: GameRecord['outcome']; by: string } {
  const live = seats.filter((c): c is SeatSnapshot => c !== null);
  for (const c of live) {
    if (c.status.kind === 'desync') return { outcome: 'void', by: 'desync' };
  }
  const results = live.map((c) => c.result);
  const decided = results.filter((r): r is MatchResult => r !== null);
  const toOutcome = (r: MatchResult, by: string): { outcome: GameRecord['outcome']; by: string } => (
    r.kind === 'draw' ? { outcome: 'draw', by } : { outcome: `seat${seatOfSide(sides, r.side)}`, by }
  );
  if (decided.length > 0) {
    // Two sims that ran the same frames reach the same result, or the game proves nothing.
    if (decided.some((r) => JSON.stringify(r) !== JSON.stringify(decided[0]))) return { outcome: 'void', by: 'disagree' };
    // One decided and one did not: only a room's ending, which the leaver never hears, may do that.
    if (decided.length < results.length && !ROOM_ENDINGS.includes(decided[0].by)) return { outcome: 'void', by: 'disagree' };
    return toOutcome(decided[0], decided[0].by);
  }
  const referee = seats[0] ?? seats[1];
  if (referee !== null && referee.sim !== null && live.every((c) => c.tick === capTicks)) return toOutcome(capOutcome(referee.sim), 'cap');
  const st = referee?.status;
  return { outcome: 'void', by: st?.kind === 'closed' ? st.reason : 'unfinished' };
}

/** Why the room's start config cannot be trusted for this game, or null.
 *  A malformed pace is silently realtime, and a realtime run proves nothing here. */
export function untrusted(config: Pick<MatchConfig, 'pace' | 'seed' | 'map' | 'seats'>, a: Pick<ArenaArgs, 'pace' | 'roundWallMs' | 'map' | 'matchup'>, seed: number): string | null {
  const want = { kind: 'paced', roundTicks: a.pace, roundWallMs: a.roundWallMs };
  const pace = config.pace;
  if (pace.kind !== 'paced' || pace.roundTicks !== want.roundTicks || pace.roundWallMs !== want.roundWallMs) {
    return `the room started at pace ${JSON.stringify(pace)}, not ${JSON.stringify(want)}`;
  }
  if (config.seed !== seed) return `the room started on seed ${config.seed}, not ${seed}`;
  if (config.map !== a.map) return `the room started on ${config.map}, not ${a.map}`;
  const wantFactions = factionsOfMatchup(a.matchup);
  const factions = [config.seats[0].faction, config.seats[1].faction];
  if (factions[0] !== wantFactions[0] || factions[1] !== wantFactions[1]) return `the room seated ${factions.join('/')}, not ${wantFactions.join('/')} (${a.matchup})`;
  return null;
}

interface GameSpec {
  seed: number;
  players: [ArenaPlayer, ArenaPlayer];
  names: [string, string];
  /** `<out>/<game>`: the prefix of each seat's `-seat<n>.log`. */
  logBase: string;
}

/** How long the observer's advisor ticket may take. */
const OBSERVER_TICKET_MS = 10_000;

/**
 * The arena's reader for a game neither of whose seats runs here: seat 0's
 * own advisor, on an `advise` ticket the room's advisor route mints from seat
 * 0's ticket (decision D1: a seat invites its own). It keeps its own sim in
 * step from the frame stream every socket receives (decision D10) and stops,
 * as the in-process player does, on a result, the room ending, a desync or
 * the cap tick, so the cap is read AT the cap. An advisor socket sends
 * nothing the room acts on but `advisor` messages, and this one sends none:
 * it orders nothing, readies nothing, and its going stalls nothing. It counts
 * toward the room's 8 sockets, as every advisor does.
 */
export async function startObserver(relay: Pick<LocalRelay, 'url' | 'origin'>, code: string, seatTicket: string, build: string, capTicks: number, log: (line: string) => void): Promise<RunningPlayer & { client: AgentClient }> {
  const res = await withTimeout(
    fetch(`${relay.url}/api/match/${encodeURIComponent(code)}/advisor`, {
      method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify({ ticket: seatTicket, scope: 'advise' }),
    }),
    OBSERVER_TICKET_MS, 'the observer\'s advisor ticket',
  );
  if (res.status !== 200) throw new Error(`the room refused the observer an advisor ticket: HTTP ${res.status}`);
  const { ticket } = (await res.json()) as { ticket?: unknown };
  if (typeof ticket !== 'string') throw new Error('the advisor route answered no ticket');
  const client = new AgentClient({ server: relay.url, code, ticket, build, role: 'advisor', seat: 0, log });
  const report: PlayerReport = { tokens: null, timeouts: 0, errors: [] };
  let finished = false;
  let loop: ReturnType<typeof setInterval> | null = null;
  let resolveDone: (r: PlayerReport) => void = () => {};
  const done = new Promise<PlayerReport>((r) => { resolveDone = r; });
  const finish = (why: string | null): void => {
    if (finished) return;
    finished = true;
    if (loop !== null) clearInterval(loop);
    if (why !== null) report.errors.push(why);
    resolveDone(report);
  };
  client.ready.then(() => {
    if (finished) return;
    loop = setInterval(() => {
      if (finished) return;
      if (client.failed() !== null) { finish(`failed: ${client.failed() ?? ''}`); return; }
      const tick = client.tick();
      const starved = tick < capTicks ? client.pump(capTicks - tick) === 0 : true;
      if (client.result() !== null) { finish(null); return; }
      const st = client.transport.status();
      if (st.kind === 'desync') { finish(`desync at tick ${st.tick}`); return; }
      if (st.kind === 'closed' && starved) { finish(`the room ended: ${st.reason}`); return; }
      if (client.tick() >= capTicks) finish(null);
    }, 1);
  }, (e: unknown) => { finish(`did not start: ${messageOf(e)}`); });
  let stopped: Promise<void> | null = null;
  return {
    client,
    done,
    stop: () => {
      stopped ??= (async () => {
        finish(null);
        // An advisor always detaches quietly: no `bye`, nothing for the room to act on.
        client.close();
        await done;
      })();
      return stopped;
    },
  };
}

/** One game on its own relay, to a result or the cap. Every player and the
 *  relay are closed before it returns, whatever happened. */
async function playGame(g: GameSpec, a: ArenaArgs, build: string, startRelay: NonNullable<ArenaDeps['startRelay']>, observe: typeof startObserver, log: (line: string) => void): Promise<GameRecord> {
  const relay = await startRelay({ tickMs: a.tickMs, seedFor: () => g.seed, log });
  const running: RunningPlayer[] = [];
  let observer: (RunningPlayer & { client: AgentClient }) | null = null;
  try {
    const { code, tickets } = await openRoom(relay, a, build, g.names);
    for (const seat of [0, 1] as const) {
      running.push(await g.players[seat].start({ server: relay.url, origin: relay.origin, code, seat, ticket: tickets[seat], build, capTicks: a.capTicks, logFile: `${g.logBase}-seat${seat}.log` }));
    }
    const clients: [AgentClient | null, AgentClient | null] = [running[0].client, running[1].client];
    // An external player has no client here: with neither seat in this
    // process, the arena reads the game through seat 0's own advisor.
    if (clients[0] === null && clients[1] === null) observer = await observe(relay, code, tickets[0], build, a.capTicks, log);
    const referee = clients[0] ?? clients[1] ?? observer?.client ?? null;
    if (referee === null) throw new Error('the arena has no client to read the match through');
    const config = await withTimeout(referee.ready, START_TIMEOUT_MS, 'the match start');
    // Trust nothing the room did not confirm.
    const distrust = untrusted(config, a, g.seed);
    if (distrust !== null) throw new Error(distrust);
    const factions: GameRecord['factions'] = [config.seats[0].faction, config.seats[1].faction];

    // A backstop only: every round waited out by wall time, plus a minute.
    const budgetMs = (Math.ceil(a.capTicks / a.pace) + 2) * a.roundWallMs + 60_000;
    let timedOut = false;
    // The game is over when everything that READS it here is: the in-process
    // seats, or the observer. An external player cannot stop itself at the
    // cap, so it is waited for only through them, and then stopped.
    const readers = [...running.filter((r) => r.client !== null), ...(observer === null ? [] : [observer])];
    await withTimeout(Promise.all(readers.map((r) => r.done)), budgetMs, 'the game').catch((e: unknown) => {
      timedOut = true;
      log(`seed ${g.seed}: ${messageOf(e)}`);
    });
    // Read the room's last word BEFORE stopping: a stop closes the transport
    // (`SeatSnapshot`). The observer advises seat 0 and holds seat 0's sim,
    // so it stands in seat 0's place for `judge`.
    const seen: [SeatSnapshot | null, SeatSnapshot | null] = observer === null
      ? [clients[0] && snapshotOf(clients[0]), clients[1] && snapshotOf(clients[1])]
      : [snapshotOf(observer.client), null];
    if (observer !== null) await observer.stop();
    for (const r of running) await r.stop();
    const reports = await Promise.all(running.map((r) => r.done)) as [PlayerReport, PlayerReport];
    const sides: [0 | 1, 0 | 1] = [config.seats[0].side as 0 | 1, config.seats[1].side as 0 | 1];
    const verdict = timedOut ? { outcome: 'void' as const, by: 'timeout' } : judge(seen, sides, a.capTicks);
    const sim = referee.world()?.sim;
    if (sim === undefined) throw new Error('the reading seat never built its world');
    return {
      seed: g.seed, map: a.map, matchup: a.matchup, players: g.names, factions,
      outcome: verdict.outcome, by: verdict.by, ticks: referee.tick(), score: scoreOf(sim), reports,
    };
  } finally {
    // Every close is guarded: one that fails is logged and the next still runs.
    if (observer !== null) {
      try { await observer.stop(); } catch (e) { log(`stopping the observer: ${messageOf(e)}`); }
    }
    for (const r of running) {
      try { await r.stop(); } catch (e) { log(`stopping a player: ${messageOf(e)}`); }
    }
    // A failed close is logged, never thrown: it must not mask the game's own error.
    try { await relay.close(); } catch (e) { log(`closing the relay: ${messageOf(e)}`); }
  }
}

/** The first `<base><n>.jsonl`/`.md` pair not already in `dir`. */
function freshBase(dir: string, base: string): string {
  for (let n = 1; ; n++) {
    const b = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(join(dir, `${b}.jsonl`)) && !existsSync(join(dir, `${b}.md`))) return b;
  }
}

/** The arena, from a command line. Never calls `process.exit`. */
export async function runArena(argv: readonly string[], deps: ArenaDeps = {}): Promise<ArenaRun> {
  const log = deps.log ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const print = deps.print ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const startRelay = deps.startRelay ?? startLocalRelay;
  const observe = deps.startObserver ?? startObserver;
  const fail = (code: number, why: string): ArenaRun => { log(`arena: ${why}`); return { code, games: [], tally: null, files: null }; };

  const a = parseArgs(argv);
  if ('error' in a) return fail(1, a.error);
  const refused = refusalOf(a.map, a.matchup);
  if (refused !== null) return fail(2, refused);
  // The two names a tally keys on: a player against itself is still two players.
  const names: [string, string] = a.a === a.b ? [`${a.a}#a`, `${a.b}#b`] : [a.a, a.b];
  let A: ArenaPlayer;
  let B: ArenaPlayer;
  try {
    const resolveOne = deps.resolvePlayer ?? resolvePlayer;
    A = resolveOne(a.a, log);
    B = resolveOne(a.b, log);
  } catch (e) {
    return fail(1, messageOf(e));
  }

  // `pnpm --filter` runs this from tools/: a relative path means what it says where the user ran pnpm.
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), a.out ?? 'arena-results');
  mkdirSync(dir, { recursive: true });
  const date = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const base = freshBase(dir, `${date}-${fileSafe(a.a)}-vs-${fileSafe(a.b)}`);
  const files = { jsonl: join(dir, `${base}.jsonl`), md: join(dir, `${base}.md`) };
  writeFileSync(files.jsonl, '');
  const build = buildId();
  const games: GameRecord[] = [];
  let code = 0;
  log(`arena: ${names[0]} vs ${names[1]}, ${a.seeds} seed(s) x 2 on ${a.map} (${a.matchup}), pace ${a.pace}, cap ${a.capTicks}`);
  try {
    for (let n = 0; n < a.seeds; n++) {
      const seed = seedOf(n);
      // Game 1: A on seat 0. Game 2: the same seed with the seats swapped.
      const orders: GameSpec[] = [
        { seed, players: [A, B], names: [names[0], names[1]], logBase: join(dir, `${base}-game${2 * n + 1}`) },
        { seed, players: [B, A], names: [names[1], names[0]], logBase: join(dir, `${base}-game${2 * n + 2}`) },
      ];
      for (const g of orders) {
        const record = await playGame(g, a, build, startRelay, observe, log);
        games.push(record);
        appendFileSync(files.jsonl, `${JSON.stringify(record)}\n`);
        const winner = record.outcome === 'seat0' ? record.players[0] : record.outcome === 'seat1' ? record.players[1] : record.outcome;
        log(`arena: seed ${seed}, ${record.players[0]} (seat 0) vs ${record.players[1]} (seat 1): ${winner} (${record.by}) at tick ${record.ticks}`);
      }
    }
  } catch (e) {
    log(`arena: a game could not be played: ${messageOf(e)}`);
    code = 1;
  }
  writeFileSync(files.md, markdownReport(games));
  const t = tally(games);
  print(`arena: ${games.length} game(s) -> ${files.jsonl}`);
  print(`arena: report -> ${files.md}`);
  for (const row of t.values()) {
    print(`  ${row.player}: score ${Number.isNaN(row.score) ? '—' : row.score.toFixed(3)} (${row.wins} won, ${row.draws} drawn, ${row.losses} lost, ${row.voids} void)`);
  }
  return { code, games, tally: t, files };
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
  runArena(process.argv.slice(2)).then(
    (r) => { process.exit(r.code); },
    (err: unknown) => { process.stderr.write(`arena: ${messageOf(err)}\n`); process.exit(1); },
  );
}
