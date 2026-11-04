/**
 * `pnpm arena` (N4b task 13, decision D7): two players, each seed played
 * twice with the seats swapped, on the local relay -- the real Worker routes
 * and the real `MatchRoom` on 127.0.0.1, one relay per game, nothing billed
 * and nothing beyond loopback.
 *
 *   pnpm arena -- --a rush --b passive --seeds 10 --map tel_marum [--matchup mirror|kdf|sarim]
 *                 [--pace 60] [--round-wall-ms 120000] [--cap-ticks 12000 (the map's cap with --mode)] [--tick-ms 2] [--out arena-results/] [--gate]
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
 * nothing is ever written outside it. stdout carries the files written, the
 * tally and A against B (`n`, A's score, and `p`, the one-sided exact binomial
 * that A is better than B: `headToHead`); every log line goes to stderr.
 *
 * `--gate` (ruled 15 Oct, coordinator, lead-delegated) then judges the run:
 * PASS iff p < 0.05 for A over B over the non-void games, printed as one line
 * `gate: PASS|FAIL  <A> over <B>  n=<n>  score=<s>  p=<p>` (`gateVerdict`).
 *
 * `--judge "cmd:<template>"` (GH-973, the lead's ruling of 3 Nov) has a THIRD model
 * score both players of each finished game, 1-10 on five criteria with a one-line
 * reason each and an overall, from the referee's end-of-match stats (`judge.ts`,
 * `match-score.ts`). The stats are in every record (`referee`), judged or not; the
 * judge's outcome is `judge` (scored, invalid, failed or skipped, with the reason).
 * Scores are for reading: the judge runs after the game's relay is closed and
 * touches no outcome, tally, gate or exit code (D7). Without `--judge` the report's
 * score section says "Not judged".
 *
 * `--watch` (GH-954 W1, `docs/net/arena-watch.md` when written, the design in `_coord/arena-watch/design.md`)
 * lets you WATCH a run live in a browser, LOCAL ONLY. It implies `--serve`: one 127.0.0.1 process
 * (`arena-serve.ts`) that serves the DEV-only screen `/arena/watch` through Vite's dev server in middleware
 * mode and `/arena/api/live` (the running game's relay, code, a spectator ticket). It prints the URL with the
 * one-run token in the fragment. Each game's relay then allows the server's origin, mints spectator tickets
 * (`ARENA_WATCH`), and lingers 5 s after the game so the page hears the result. `--tick-ms` defaults to 50
 * (real time between a model's holds) instead of 2; the room's clock is a recorded parameter and results are
 * comparable only at the same pace. A watcher is a separate ticket role the room ignores after hello: it
 * cannot change a record (arena.test pins that with 0 and 2 watchers). `--serve` alone starts the server
 * without the watch features (the setup screen, W2).
 *
 * Each game's referee frames, the match config and the build are also written to `<out>/<game>.frames.jsonl`
 * (GH-954 W3, D-W9; `arena-frames.ts`, format in `packages/app/src/net/replay-file.ts`), with an independent sim's
 * final digest beside the referee's. The file holds no template and no token (players are display names; the run's
 * secrets are redacted). `/arena/results` lists the runs and `/arena/replay` runs a game again at 0.5x to 8x.
 *
 * `--serve` ALONE (GH-954 W2) starts the SETUP screen's server and nothing else: `/arena` and the control API
 * (`arena-control.ts`: players, start, stop, status). The page starts a run with a POST; it is this same `runArena`
 * on this same server, always watched. `--a`/`--b`/`--judge` also take `preset:<id>` from
 * `~/.roaring-lions/arena-players.json` (`--players-file` names another), templates only, mode 0600: a file that
 * group or world can read refuses the server and the run. The setup screen may hand ONE run a private API token: it
 * is held in memory, reaches that run's children as `ANTHROPIC_API_KEY` and nowhere else, is redacted from every line
 * the run logs, prints or writes (`redact.ts`), and is deleted when the run ends (`arena-control.ts` has the whole
 * list). Stop is `stopRun()`: a signal's cleanup without the exit.
 *
 * Exit codes: 0 every game played (voids included: a void is a result of the
 * arena, not a failure of it); 1 a bad command line, a player that cannot be
 * built, or a game that could not be played (a relay, a room or a start
 * config the arena could not trust); 2 a map or matchup no room offers,
 * refused before any room exists; 3 (only with `--gate`) every game played
 * and the gate FAILED. A run that ends 1 is not judged (`gate: not judged`)
 * and stays 1. Without `--gate` no exit code changes.
 *
 * SIGINT and SIGTERM (`installSignalCleanup`, the CLI entry only) do what the
 * skipped `finally` blocks would: every external child is stopped and every
 * seat's temp directory, ticket and all, removed (`abortExternalPlayers`),
 * every running player stopped and every relay closed; then the arena exits
 * 130 (SIGINT) or 143 (SIGTERM). From the first signal no new game or seat
 * starts (the stop latch). A SECOND signal while that runs exits at once with
 * the same code, cleanup unfinished: the escape hatch for a stuck stop. The
 * run's own exit code never overtakes the signal's.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MATCHUPS, factionsOfMatchup, matchCapTicks, matchupAllowed, versusMapAllowed, winModeRequest, type MatchConfig, type Matchup, type TransportStatus, type WinMode } from '@lions/net';
import { goalsOf, productionOf, type MatchResult, type OutcomeGoals, type OutcomeProduction, type OutcomeSim } from '../../../packages/app/src/net/outcome';
import { scoreOf, type MatchScore } from '../../../packages/app/src/net/scoreboard';
import { AgentClient } from './agent-client';
import { displayName, recordGame, writeFrames, type GameFrames } from './arena-frames';
import { gateVerdict, headToHead, markdownReport, pval, tally, type GameRecord, type GateVerdict, type Tally } from './arena-score';
import { buildId } from './build-id';
import { currentPromptDigest } from './arena-record';
import { capOutcome } from './cap';
import { JUDGE_PLACEHOLDERS, runJudge, type JudgeJob, type JudgeRecord } from './judge';
import { startLocalRelay, type LocalRelay, type LocalRelayOptions } from './local-relay';
import { startArenaServe, type ArenaServe, type ArenaServeOptions, type GameStart } from './arena-serve';
import { createArenaControl, type ArenaControl } from './arena-control';
import { loadPresets, presetIdOf, PresetsError, type Presets } from './arena-presets';
import { abortExternalPlayers, externalPlayer, externalPlayersStopped, parseTemplate, rearmExternalPlayers } from './external-player';
import { redactText } from './redact';
import { MODE_FLAG_VALUES, modeFlag } from './win-rule';
import { inProcess, passive, rush, type ArenaPlayer, type PlayerReport, type RunningPlayer } from './players';

export interface ArenaArgs {
  /** Player specs: `passive`, `rush`, `cmd:<template>` (Task 14), or `preset:<id>` (GH-954 W2, `arena-presets.ts`). */
  a: string;
  b: string;
  seeds: number;
  /** The first game's index in the probe's seed sequence (`seedOf`): seeds
   *  `seedOf(firstSeed)` .. `seedOf(firstSeed + seeds - 1)`. Default 0 (1000). */
  firstSeed: number;
  map: string;
  matchup: Matchup;
  /** GH-976 P2 (`--mode=points`): the win mode to play, or absent for annihilation. Only a mode the lobby would offer on this map
   *  (`refusalOf`: exit 2 otherwise); the room is asked for it and the arena trusts a game only if the room confirms it. */
  winMode?: WinMode;
  /** Ticks a paced round (the room clamps to 20-1,200, D5: refused outside that here). */
  pace: number;
  roundWallMs: number;
  capTicks: number;
  /** The relay rooms' clock period. */
  tickMs: number;
  /** null: `arena-results/` under the invoking directory. */
  out: string | null;
  /** Judge the run: exit 3 unless A beats B with p < 0.05. */
  gate: boolean;
  /** `cmd:<template>` (or `preset:<id>`, resolved to its judge template before a game) of the third model that scores both players of each game (GH-973); null: not judged. */
  judge: string | null;
  /** How long one judge may take, per game. */
  judgeTimeoutMs: number;
  /** GH-954 W1: serve the DEV-only watch screen and let a browser watch each game live. Implies `serve`. */
  watch: boolean;
  /** GH-954 W1: run `arena-serve.ts` (127.0.0.1, token-guarded). */
  serve: boolean;
  /** The port `--serve` binds; 0: the OS picks. */
  servePort: number;
  /** GH-954 W2: the presets file (`arena-presets.ts`); null: `~/.roaring-lions/arena-players.json`. */
  playersFile: string | null;
}

/** The relay's linger after a game's result, so a spectator hears it (`--watch`). */
export const WATCH_LINGER_MS = 5000;
/** `--tick-ms` under `--watch`: the room's own clock, real time between holds (decision D-W5). */
export const WATCH_TICK_MS = 50;

/** `--gate` FAILED: every game was played and A was not told from B at p < 0.05. */
export const EXIT_GATE_FAIL = 3;

const USAGE = 'usage: pnpm arena -- --a <player> --b <player> [--seeds 10] [--first-seed 0] [--map tel_marum] [--matchup mirror|kdf|sarim] [--mode annihilation|points] [--pace 60] [--round-wall-ms 120000] [--cap-ticks 12000] [--tick-ms 2] [--out arena-results/] [--gate] [--judge "cmd:<template>"] [--judge-timeout-ms 180000] [--watch] [--serve] [--serve-port 0] [--players-file <path>]\n  --watch: watch a run live in a browser (local only; implies --serve; --tick-ms defaults to 50); a player is passive, rush, cmd:<template> or preset:<id> (from ~/.roaring-lions/arena-players.json, mode 0600); `pnpm arena --serve` alone starts the setup screen at /arena; the judge scores both players of each game on the rubric (placeholders {prompt}, {stats})';
const VALUED = new Set(['a', 'b', 'seeds', 'first-seed', 'map', 'matchup', 'mode', 'pace', 'round-wall-ms', 'cap-ticks', 'tick-ms', 'out', 'judge', 'judge-timeout-ms', 'serve-port', 'players-file']);
/** Options that take no value. */
const FLAGS = new Set(['gate', 'watch', 'serve']);
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
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;   // pnpm passes the separator through
    if (!arg.startsWith('--')) return { error: `unexpected argument "${arg}"\n${USAGE}` };
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    if (FLAGS.has(name)) {
      if (eq >= 0) return { error: `--${name} takes no value` };
      flags.add(name);
      continue;
    }
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
    if (!Object.hasOwn(BUILT_IN, p) && !EXTERNAL.test(p) && presetIdOf(p) === null) return { error: `unknown player "${p}": passive, rush, cmd:<template> or preset:<id>` };
  }
  const matchup = got.get('matchup') ?? 'mirror';
  if (!(MATCHUPS as readonly string[]).includes(matchup)) return { error: `--matchup is ${MATCHUPS.join(', ')}` };
  const modeValue = got.get('mode');
  const winMode = modeValue === undefined ? null : modeFlag(modeValue);
  if (winMode === undefined) return { error: `--mode is ${MODE_FLAG_VALUES}` };
  const seeds = intIn('seeds', got.get('seeds'), 10, 1, 10_000);
  const firstSeed = intIn('first-seed', got.get('first-seed'), 0, 0, 1_000_000);
  const pace = intIn('pace', got.get('pace'), 60, 20, 1200);
  const roundWallMs = intIn('round-wall-ms', got.get('round-wall-ms'), 120_000, 1000, 600_000);
  // GH-976 P2: a points game runs about 13.6k-14.8k ticks on average, so the 12,000 default would end many on the cap rule
  // (surviving force) with the HUD showing the other side ahead: with a mode named, the default is the map's own cap.
  const mapCap = matchCapTicks(got.get('map') ?? 'tel_marum');
  const capTicks = intIn('cap-ticks', got.get('cap-ticks'), modeValue !== undefined && winMode !== null ? mapCap : 12_000, 1, mapCap);
  const watch = flags.has('watch');
  const tickMs = intIn('tick-ms', got.get('tick-ms'), watch ? WATCH_TICK_MS : 2, 1, 1000);
  const servePort = intIn('serve-port', got.get('serve-port'), 0, 0, 65_535);
  const judgeTimeoutMs = intIn('judge-timeout-ms', got.get('judge-timeout-ms'), 180_000, 1000, 1_800_000);
  for (const v of [seeds, firstSeed, pace, roundWallMs, capTicks, tickMs, judgeTimeoutMs, servePort]) if (typeof v !== 'number') return v;
  const judge = got.get('judge') ?? null;
  if (judge !== null) {
    if (presetIdOf(judge) === null) {
      if (!EXTERNAL.test(judge)) return { error: '--judge is cmd:<template>, in the players\' own form (no key belongs in it), or preset:<id>' };
      try { parseTemplate(judge, JUDGE_PLACEHOLDERS); } catch (e) { return { error: `--judge: ${messageOf(e)}` }; }
    }
  }
  return {
    a, b,
    seeds: seeds as number,
    firstSeed: firstSeed as number,
    map: got.get('map') ?? 'tel_marum',
    matchup: matchup as Matchup,
    ...(winMode === null ? {} : { winMode }),
    pace: pace as number,
    roundWallMs: roundWallMs as number,
    capTicks: capTicks as number,
    tickMs: tickMs as number,
    out: got.get('out') ?? null,
    gate: flags.has('gate'),
    judge,
    judgeTimeoutMs: judgeTimeoutMs as number,
    watch,
    serve: watch || flags.has('serve'),
    servePort: servePort as number,
    playersFile: got.get('players-file') ?? null,
  };
}

/** The name a player is tallied and filed under: a preset's id (never its template), anything else as given. */
export const nameOf = (spec: string): string => presetIdOf(spec) ?? spec;

/** What `--serve` alone means: the setup screen's server, no run until the page starts one. */
export interface ServeOnlyArgs { port: number; playersFile: string | null; out: string | null }

/** `--serve` with neither `--a` nor `--b`: the options of the server alone, or what is wrong; null when this is not that. */
export function parseServeOnly(argv: readonly string[]): ServeOnlyArgs | { error: string } | null {
  const rest = argv.filter((x) => x !== '--');
  const named = (n: string): boolean => rest.some((x) => x === `--${n}` || x.startsWith(`--${n}=`));
  if (!named('serve') || named('a') || named('b') || named('watch')) return null;
  const got = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--serve') continue;
    if (!arg.startsWith('--')) return { error: `unexpected argument "${arg}"\n${USAGE}` };
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    if (!['serve-port', 'players-file', 'out'].includes(name)) return { error: `--serve alone takes --serve-port, --players-file and --out, not --${name}\n${USAGE}` };
    const value = eq >= 0 ? arg.slice(eq + 1) : rest[++i];
    if (value === undefined || value === '') return { error: `--${name} needs a value` };
    got.set(name, value);
  }
  const port = intIn('serve-port', got.get('serve-port'), 0, 0, 65_535);
  if (typeof port !== 'number') return port;
  return { port, playersFile: got.get('players-file') ?? null, out: got.get('out') ?? null };
}

/** Why no room would host this, or null: the route's own two questions. */
export function refusalOf(map: string, matchup: Matchup, winMode?: WinMode): string | null {
  if (!versusMapAllowed(map)) return `no versus room is offered on ${map}`;
  if (!matchupAllowed(matchup, map)) return `the ${matchup} matchup is not offered on ${map} (mirror only)`;
  // GH-976 P2: the Worker's own question (`winModeRequest`), asked before a relay starts.
  const mode = winModeRequest(winMode ?? null, { mode: 'versus', map, matchup });
  if (mode.refused !== undefined) return `no ${winMode ?? 'annihilation'} room: ${mode.refused} (${map}, ${matchup})`;
  return null;
}

/** The player a spec names. A `cmd:` template that cannot be run (an open
 *  quote, a placeholder that is not one) throws here, before any room. */
export function resolvePlayer(spec: string, log: (line: string) => void, ctx: ResolveContext = {}): ArenaPlayer {
  const make = Object.hasOwn(BUILT_IN, spec) ? BUILT_IN[spec] : undefined;
  if (make !== undefined) return make(log);
  if (EXTERNAL.test(spec)) return externalPlayer(spec, spec, ctx.env === undefined ? {} : { env: ctx.env });
  const id = presetIdOf(spec);
  if (id !== null) {
    const preset = ctx.presets?.byId.get(id);
    if (preset === undefined) throw new Error(`no preset "${id}" in ${ctx.presets?.file ?? 'the presets file'}`);
    if (preset.template === null) throw new Error(`preset "${id}" is a judge, not a player`);
    // Named by the preset's id: the results never carry its template.
    return externalPlayer(id, preset.template, ctx.env === undefined ? {} : { env: ctx.env });
  }
  throw new Error(`unknown player "${spec}"`);
}

/** What a `preset:` player needs to be built (GH-954 W2): the presets, and the variables its child is handed. */
export interface ResolveContext {
  presets?: Presets;
  env?: Readonly<Record<string, string>>;
}

export interface ArenaDeps {
  /** stderr by default. */
  log?: (line: string) => void;
  /** stdout by default: the files written and the tally. */
  print?: (line: string) => void;
  /** The local relay, per game. */
  startRelay?: (o: LocalRelayOptions) => Promise<LocalRelay>;
  /** The player a spec names; default `resolvePlayer`. */
  resolvePlayer?: (spec: string, log: (line: string) => void, ctx?: ResolveContext) => ArenaPlayer;
  /** The reader for a game with no in-process seat; default `startObserver`. */
  startObserver?: typeof startObserver;
  /** The judge (GH-973); default `runJudge`. A spec injects a stub: no spec runs a model. */
  runJudge?: (job: JudgeJob) => Promise<JudgeRecord>;
  now?: () => Date;
  /** GH-954 W1: the server `--serve` starts; default `startArenaServe`. A spec injects a stub. */
  startServe?: (o: ArenaServeOptions) => Promise<ArenaServe>;
  /** GH-954 W2: a server that is already up (the setup screen's): the run uses it and leaves it open. */
  serve?: ArenaServe;
  /** GH-954 W2: presets already read (the server read them at start); default: read when a `preset:` is named. */
  presets?: Presets;
  /** GH-954 W2: variables added to every external child of THIS run (a private API token the setup screen was
   *  handed, in memory). Everything the run logs, prints or writes passes `redactText` with these values. */
  env?: Readonly<Record<string, string>>;
  /** Called once a game's room is confirmed and its players are running (its relay, code and seat ticket are in
   *  `info`), BEFORE the game is played to its end. A throw is logged and never stops the game. */
  onGameStart?: (info: GameStart) => void;
  /** Called with the game's record once its verdict is known, before its relay's linger and close. */
  onGameEnd?: (end: { n: number; of: number; record: GameRecord; referee: RefereeDigest }) => void;
}

export interface ArenaRun {
  code: number;
  games: GameRecord[];
  tally: Map<string, Tally> | null;
  files: { jsonl: string; md: string } | null;
  /** `--gate`'s verdict; null without `--gate`, or when the run was not judged. */
  gate: GateVerdict | null;
  /** GH-954 W2: why the run ended non-zero, in one line (already redacted); absent on a run that finished. */
  error?: string;
  /** GH-954 W2: `--serve` alone returns once the server is up: the server, still running, for the caller to close. */
  serving?: ArenaServe;
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
  const created = await post(relay, '/api/match', { player: randomUUID(), callsign: names[0].slice(0, 16), build, map: a.map, mode: 'versus', matchup: a.matchup, kind: 'bot', pace, ...(a.winMode === undefined ? {} : { winMode: a.winMode }) });
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
  /** The economy half of the win rule (an economy room only). */
  production?: OutcomeProduction;
  /** The goal of a win-mode room (GH-976 P2): read by `capOutcome`, so a goal completed by the cap is not lost to the cap rule. */
  goals?: OutcomeGoals;
}

/** A seat's client as it stands now. Call before `stop()`. */
export function snapshotOf(c: AgentClient): SeatSnapshot {
  const w = c.world();
  const production = w === null ? undefined : productionOf(w);
  const goals = w === null ? undefined : goalsOf(w);
  return { result: c.result(), tick: c.tick(), status: c.transport.status(), sim: c.world()?.sim ?? null, ...(production !== undefined ? { production } : {}), ...(goals !== undefined ? { goals } : {}) };
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
  map?: string,
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
  if (referee !== null && referee.sim !== null && live.every((c) => c.tick === capTicks)) {
    const atCap = capOutcome(referee.sim, referee.production, map, referee.goals);
    // A goal completed by the cap is the objective's win, not the cap's (GH-976 P2).
    return toOutcome(atCap, atCap.kind === 'won' && atCap.by === 'objective' ? 'objective' : 'cap');
  }
  const st = referee?.status;
  return { outcome: 'void', by: st?.kind === 'closed' ? st.reason : 'unfinished' };
}

/** Why the room's start config cannot be trusted for this game, or null.
 *  A malformed pace is silently realtime, and a realtime run proves nothing here. */
export function untrusted(config: Pick<MatchConfig, 'pace' | 'seed' | 'map' | 'seats'> & { winMode?: WinMode }, a: Pick<ArenaArgs, 'pace' | 'roundWallMs' | 'map' | 'matchup'> & { winMode?: WinMode }, seed: number): string | null {
  const want = { kind: 'paced', roundTicks: a.pace, roundWallMs: a.roundWallMs };
  const pace = config.pace;
  if (pace.kind !== 'paced' || pace.roundTicks !== want.roundTicks || pace.roundWallMs !== want.roundWallMs) {
    return `the room started at pace ${JSON.stringify(pace)}, not ${JSON.stringify(want)}`;
  }
  if (config.seed !== seed) return `the room started on seed ${config.seed}, not ${seed}`;
  if (config.map !== a.map) return `the room started on ${config.map}, not ${a.map}`;
  if ((config.winMode ?? null) !== (a.winMode ?? null)) return `the room started on ${config.winMode ?? 'annihilation'}, not ${a.winMode ?? 'annihilation'}`;
  const wantFactions = factionsOfMatchup(a.matchup);
  const factions = [config.seats[0].faction, config.seats[1].faction];
  if (factions[0] !== wantFactions[0] || factions[1] !== wantFactions[1]) return `the room seated ${factions.join('/')}, not ${wantFactions.join('/')} (${a.matchup})`;
  return null;
}

interface GameSpec {
  /** 1-based number in the run, and the run's total (`--seeds` x 2): what a watcher's strip shows. */
  n: number;
  of: number;
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
  const client = new AgentClient({ server: relay.url, code, ticket, build, role: 'advisor', seat: 0, log, keepFrames: true });
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

/** GH-954 W2: what a Stop wakes. A game waiting on its room's start (up to `START_TIMEOUT_MS`) would otherwise keep
 *  a stopped run alive for 30 s after its players were killed. */
const stopWaiters = new Set<(e: Error) => void>();
function untilStopped(): Promise<never> {
  // A Stop that has already run woke the waiters that existed THEN; one that arrives after would wait out the
  // whole start timeout with its players already killed, so it is refused at once.
  if (externalPlayersStopped()) return Promise.reject(new Error('the run was stopped'));
  return new Promise<never>((_, rej) => { stopWaiters.add(rej); });
}

/** What is running right now, for a signal: `playGame` adds each relay and
 *  player as it starts and removes it once its own `finally` has closed it. */
const liveRelays = new Set<LocalRelay>();
const liveServes = new Set<ArenaServe>();
const livePlayers = new Set<RunningPlayer>();

/** What `runArena` hands one game beyond its spec: the server's origins the relay must allow, and the two hooks. */
interface GameHooks {
  allowOrigins?: readonly string[];
  onStart?: (info: GameStart) => void;
  /** `frames`: every frame the referee ran with the room's config (GH-954 W3), null when the reading client kept none. */
  onEnd?: (record: GameRecord, referee: RefereeDigest, frames: GameFrames | null) => void;
}

/** The referee's sim at the game's end: its tick and `sim.hash()`. A headless watcher compares its own against it. */
export interface RefereeDigest { tick: number; hash: number }

/** One game on its own relay, to a result or the cap. Every player and the
 *  relay are closed before it returns, whatever happened. */
async function playGame(g: GameSpec, a: ArenaArgs, build: string, promptDigest: string, startRelay: NonNullable<ArenaDeps['startRelay']>, observe: typeof startObserver, log: (line: string) => void, hooks: GameHooks = {}): Promise<GameRecord> {
  const relay = await startRelay({
    tickMs: a.tickMs, seedFor: () => g.seed, log,
    ...(a.watch ? { watch: true, lingerMs: WATCH_LINGER_MS } : {}),
    ...(hooks.allowOrigins === undefined ? {} : { allowOrigins: hooks.allowOrigins }),
  });
  liveRelays.add(relay);
  const running: RunningPlayer[] = [];
  let observer: (RunningPlayer & { client: AgentClient }) | null = null;
  try {
    const { code, tickets } = await openRoom(relay, a, build, g.names);
    for (const seat of [0, 1] as const) {
      const r = await g.players[seat].start({ server: relay.url, origin: relay.origin, code, seat, ticket: tickets[seat], build, capTicks: a.capTicks, winMode: a.winMode ?? null, logFile: `${g.logBase}-seat${seat}.log`, keepFrames: true });
      running.push(r);
      livePlayers.add(r);
    }
    // A Stop that landed while a seat was starting: no observer, no wait for a match that will not start.
    if (externalPlayersStopped()) throw new Error('the run was stopped');
    const clients: [AgentClient | null, AgentClient | null] = [running[0].client, running[1].client];
    // An external player has no client here: with neither seat in this
    // process, the arena reads the game through seat 0's own advisor.
    if (clients[0] === null && clients[1] === null) {
      observer = await observe(relay, code, tickets[0], build, a.capTicks, log);
      livePlayers.add(observer);
    }
    const referee = clients[0] ?? clients[1] ?? observer?.client ?? null;
    if (referee === null) throw new Error('the arena has no client to read the match through');
    const config = await Promise.race([withTimeout(referee.ready, START_TIMEOUT_MS, 'the match start'), untilStopped()]);
    // Trust nothing the room did not confirm.
    const distrust = untrusted(config, a, g.seed);
    if (distrust !== null) throw new Error(distrust);
    const factions: GameRecord['factions'] = [config.seats[0].faction, config.seats[1].faction];
    // GH-954 W1: the room is confirmed and its players are in: a watcher may be sent here now. A hook that
    // throws costs the watch, never the game.
    try {
      hooks.onStart?.({ n: g.n, of: g.of, seed: g.seed, map: a.map, matchup: a.matchup, names: g.names, factions, code, relay: { url: relay.url, origin: relay.origin }, seatTicket: tickets[0], build, capTicks: a.capTicks, pace: a.pace, roundWallMs: a.roundWallMs });
    } catch (e) { log(`arena: onGameStart hook failed: ${messageOf(e)}`); }

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
    const verdict = timedOut ? { outcome: 'void' as const, by: 'timeout' } : judge(seen, sides, a.capTicks, a.map);
    const sim = referee.world()?.sim;
    if (sim === undefined) throw new Error('the reading seat never built its world');
    // The referee's numbers for both seats (GH-973): a read of the reading seat's sim, after the verdict, written to nothing.
    const stats = referee.refereeStats(verdictText(g.names, verdict));
    const record: GameRecord = {
      seed: g.seed, map: a.map, matchup: a.matchup, mode: a.winMode ?? 'annihilation', players: g.names, factions,
      build, pace: a.pace, roundWallMs: a.roundWallMs, capTicks: a.capTicks, promptDigest,
      outcome: verdict.outcome, by: verdict.by, ticks: referee.tick(), score: bySeat(scoreOf(sim), sides), reports,
      ...(stats === null ? {} : { referee: stats }),
    };
    // The frames the referee ran and the config it ran them under (GH-954 W3). A client that kept none (a player a spec
    // built with its own client) records nothing: no file is better than one that cannot replay.
    const kept = referee.framesRan();
    const ranUnder = referee.config();
    const frames: GameFrames | null = kept.length > 0 && ranUnder !== null ? { config: ranUnder, frames: kept } : null;
    try { hooks.onEnd?.(record, { tick: referee.tick(), hash: sim.hash() }, frames); } catch (e) { log(`arena: onGameEnd hook failed: ${messageOf(e)}`); }
    return record;
  } finally {
    // Every close is guarded: one that fails is logged and the next still runs.
    if (observer !== null) {
      try { await observer.stop(); } catch (e) { log(`stopping the observer: ${messageOf(e)}`); }
      livePlayers.delete(observer);
    }
    for (const r of running) {
      try { await r.stop(); } catch (e) { log(`stopping a player: ${messageOf(e)}`); }
      livePlayers.delete(r);
    }
    // A failed close is logged, never thrown: it must not mask the game's own error.
    try { await relay.close(); } catch (e) { log(`closing the relay: ${messageOf(e)}`); }
    liveRelays.delete(relay);
  }
}

/** The arena's verdict in words, BY NAME: what the judge is told, and the referee's `result`. */
export function verdictText(names: readonly [string, string], v: { outcome: GameRecord['outcome']; by: string }): string {
  if (v.outcome === 'seat0' || v.outcome === 'seat1') return `seat ${v.outcome === 'seat0' ? 0 : 1} (${names[v.outcome === 'seat0' ? 0 : 1]}) won (${v.by})`;
  return v.outcome === 'draw' ? `draw (${v.by})` : `void (${v.by})`;
}

/**
 * The judge's turn for one finished game (GH-973). A void game has no result to
 * judge. The judge's outcome goes ONLY into `record.judge`: nothing here touches
 * `outcome`, `by`, the score board or the tally (D7).
 */
/**
 * What the judge calls a player: a scripted control by its name, anything else (a `cmd:` template, which can carry
 * local paths and a model id) as `Player A` / `Player B`. The results files keep the real names; the judge's prompt does not.
 */
export function judgeLabel(spec: string, which: 'A' | 'B'): string {
  return EXTERNAL.test(spec) || presetIdOf(spec) !== null ? `Player ${which}` : spec;
}

async function judgeGame(record: GameRecord, a: ArenaArgs, logBase: string, judge: NonNullable<ArenaDeps['runJudge']>, log: (line: string) => void, env: Readonly<Record<string, string>> | undefined, ab: readonly [string, string]): Promise<JudgeRecord | undefined> {
  if (a.judge === null) return undefined;
  if (record.outcome === 'void') return { status: 'skipped', reason: `the game was void (${record.by})` };
  if (record.referee === undefined) return { status: 'skipped', reason: 'the arena has no referee stats for this game' };
  // A is `--a`, B is `--b`, whichever seat each sat on; a player against itself is `x#a` / `x#b`.
  const label = (seat: 0 | 1): string => {
    // `ab` is the names `--a` and `--b` were recorded under.
    const isA = record.players[seat] === ab[0];
    const l = judgeLabel(isA ? a.a : a.b, isA ? 'A' : 'B');
    return a.a === a.b && !EXTERNAL.test(a.a) && presetIdOf(a.a) === null ? `${l} (${isA ? 'A' : 'B'})` : l;
  };
  const players: [string, string] = [label(0), label(1)];
  const j = await judge({
    template: a.judge, stats: record.referee, players, outcome: verdictText(players, record),
    logFile: `${logBase}-judge.log`, timeoutMs: a.judgeTimeoutMs,
    ...(env === undefined || Object.keys(env).length === 0 ? {} : { env }),
  });
  log(`arena: seed ${record.seed}: judge: ${j.status}${j.status === 'failed' ? ` (${j.reason})` : j.status === 'invalid' ? ` (${j.problems[0] ?? ''})` : ''}`);
  return j;
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
  // GH-954 W2: the values this run holds as secrets (a private token for its children). Every line it logs or
  // prints and every byte it writes to its results passes `redactText` with them.
  // Each secret and its JSON-escaped form (a quote or a backslash in it): results are JSON, and a log line may quote one.
  const secrets = Object.values(deps.env ?? {}).flatMap((s) => [s, JSON.stringify(s).slice(1, -1)]);
  const rawLog = deps.log ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const rawPrint = deps.print ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const log = (line: string): void => { rawLog(redactText(line, secrets)); };
  const print = (line: string): void => { rawPrint(redactText(line, secrets)); };
  const startRelay = deps.startRelay ?? startLocalRelay;
  const observe = deps.startObserver ?? startObserver;
  const fail = (code: number, why: string): ArenaRun => { log(`arena: ${why}`); return { code, games: [], tally: null, files: null, gate: null, error: redactText(why, secrets) }; };

  // GH-954 W2: `--serve` alone is the setup screen's server: no run until the page starts one.
  const only = parseServeOnly(argv);
  if (only !== null) return 'error' in only ? fail(1, only.error) : runServeOnly(only, deps, log, print, fail);

  const parsed = parseArgs(argv);
  if ('error' in parsed) return fail(1, parsed.error);
  const refused = refusalOf(parsed.map, parsed.matchup, parsed.winMode);
  if (refused !== null) return fail(2, refused);
  // GH-954 W2: presets, read once, when a `preset:` is named. A file anyone else can read refuses the run.
  let presets: Presets | undefined = deps.presets;
  if (presets === undefined && [parsed.a, parsed.b, parsed.judge ?? ''].some((x) => presetIdOf(x) !== null)) {
    try { presets = loadPresets(parsed.playersFile ?? undefined); } catch (e) { return fail(1, e instanceof PresetsError ? e.message : messageOf(e)); }
  }
  let judgeTemplate = parsed.judge;
  const judgeId = parsed.judge === null ? null : presetIdOf(parsed.judge);
  if (judgeId !== null) {
    judgeTemplate = presets?.byId.get(judgeId)?.judgeTemplate ?? null;
    if (judgeTemplate === null) return fail(1, `preset "${judgeId}" is not a judge (no judgeTemplate), or is not in the presets file`);
  }
  const a: ArenaArgs = { ...parsed, judge: judgeTemplate };
  // The two names a tally keys on: a player against itself is still two players.
  // GH-954 W3: a player's name is what the results, the file names and the API show, so it is never a command line: a `cmd:`
  // spec (or anything that is not id-shaped) is `Player A` / `Player B`. A scripted name and a preset's id stand as they are.
  const [nameA, nameB] = [displayName(nameOf(a.a)) ?? 'Player A', displayName(nameOf(a.b)) ?? 'Player B'];
  const names: [string, string] = a.a === a.b ? [`${nameA}#a`, `${nameB}#b`] : [nameA, nameB];
  let A: ArenaPlayer;
  let B: ArenaPlayer;
  try {
    const resolveOne = deps.resolvePlayer ?? resolvePlayer;
    const ctx: ResolveContext = { ...(presets === undefined ? {} : { presets }), ...(deps.env === undefined ? {} : { env: deps.env }) };
    A = resolveOne(a.a, log, ctx);
    B = resolveOne(a.b, log, ctx);
  } catch (e) {
    return fail(1, messageOf(e));
  }

  // GH-954 P1: read before any file is made, so a prompt that cannot be read leaves no empty results file behind.
  let promptDigest: string;
  try { promptDigest = currentPromptDigest(parsed.winMode ?? null); } catch (e) { return fail(1, `could not read the standing prompt: ${messageOf(e)}`); }

  // `pnpm --filter` runs this from tools/: a relative path means what it says where the user ran pnpm.
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), a.out ?? 'arena-results');
  mkdirSync(dir, { recursive: true });
  const date = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const base = freshBase(dir, `${date}-${fileSafe(nameA)}-vs-${fileSafe(nameB)}`);
  const files = { jsonl: join(dir, `${base}.jsonl`), md: join(dir, `${base}.md`) };
  writeFileSync(files.jsonl, '');
  const build = buildId();
  const games: GameRecord[] = [];
  let code = 0;
  let runError: string | undefined;
  // GH-954 W1: the local server, started BEFORE the first relay so its origins can be allowed on every one.
  let serve: ArenaServe | null = deps.serve ?? null;
  const ownServe = serve === null;
  if (serve !== null) {
    serve.beginRun(a.watch ? `${names[0]} vs ${names[1]}` : null);
  } else if (a.serve) {
    try {
      serve = await (deps.startServe ?? startArenaServe)({ port: a.servePort, log, resultsDir: dir, labelOf: (id) => presets?.byId.get(id)?.label ?? null, ...(a.watch ? { runLabel: `${names[0]} vs ${names[1]}` } : {}) });
    } catch (e) {
      return fail(1, `could not start the arena server: ${messageOf(e)}`);
    }
    liveServes.add(serve);
    print(`arena: ${a.watch ? 'watch' : 'serve'}: ${serve.url(a.watch ? '/arena/watch' : '/arena')}`);
  }
  const hooks: GameHooks = {
    ...(serve === null ? {} : { allowOrigins: serve.origins }),
    onStart: (info) => { serve?.gameStarted(info); deps.onGameStart?.(info); },
    onEnd: (record) => { serve?.gameEnded(record); },
  };
  const labelOf = (id: string): string | null => presets?.byId.get(id)?.label ?? null;
  /** D-W9: this game's frames, the config and the build, with the watcher digest taken from the file's own text. */
  const recordFile = (g: GameSpec, r: GameRecord, ref: RefereeDigest, fr: GameFrames): void => {
    try {
      const rec = recordGame({
        build, game: { n: g.n, of: g.of, seed: g.seed, map: a.map, matchup: a.matchup, capTicks: a.capTicks, pace: a.pace, roundWallMs: a.roundWallMs },
        names: g.names, unnamed: g.players[0] === A ? ['Player A', 'Player B'] : ['Player B', 'Player A'], frames: fr, referee: ref, outcome: r.outcome, by: r.by, labelOf, secrets,
      });
      writeFrames(`${g.logBase}.frames.jsonl`, rec.text);
      if (!rec.agrees) log(`arena: game ${g.n}: the watcher digest (tick ${rec.watcher.tick}, ${rec.watcher.hash}) is not the referee's (tick ${ref.tick}, ${ref.hash})`);
    } catch (e) { log(`arena: game ${g.n}: could not record its frames: ${messageOf(e)}`); }
  };
  log(`arena: ${names[0]} vs ${names[1]}, ${a.seeds} seed(s) x 2 on ${a.map} (${a.matchup}), pace ${a.pace}, cap ${a.capTicks}`);
  try {
    for (let n = 0; n < a.seeds; n++) {
      const seed = seedOf(a.firstSeed + n);
      // Game 1: A on seat 0. Game 2: the same seed with the seats swapped.
      const orders: GameSpec[] = [
        { n: 2 * n + 1, of: 2 * a.seeds, seed, players: [A, B], names: [names[0], names[1]], logBase: join(dir, `${base}-game${2 * n + 1}`) },
        { n: 2 * n + 2, of: 2 * a.seeds, seed, players: [B, A], names: [names[1], names[0]], logBase: join(dir, `${base}-game${2 * n + 2}`) },
      ];
      for (const g of orders) {
        // A signal's cleanup has begun: no new relay, no new seat.
        if (externalPlayersStopped()) throw new Error('the arena is stopping (a signal): no further game');
        let kept: { r: GameRecord; ref: RefereeDigest; fr: GameFrames } | null = null;
        const record = await playGame(g, a, build, promptDigest, startRelay, observe, log, {
          ...hooks,
          onEnd: (r, ref, fr) => {
            // Only kept here: the watcher's replay of the game takes seconds on a long map, and runs below, once the game's
            // relay and players are closed (never with a live room, children and a watching page attached).
            if (fr !== null) kept = { r, ref, fr };
            hooks.onEnd?.(r, ref, fr);
            deps.onGameEnd?.({ n: g.n, of: g.of, record: r, referee: ref });
          },
        });
        if (kept !== null) {
          const k: { r: GameRecord; ref: RefereeDigest; fr: GameFrames } = kept;
          // A turn of the event loop first, so a page's poll and a signal are served before the replay holds it. A failure
          // costs the recording, never the game.
          await new Promise<void>((res) => { setImmediate(res); });
          recordFile(g, k.r, k.ref, k.fr);
        }
        // After the game, with its relay closed: a slow judge holds up the next game, never this one's result.
        const judged = await judgeGame(record, a, g.logBase, deps.runJudge ?? runJudge, log, deps.env, names);
        if (judged !== undefined) record.judge = judged;
        games.push(record);
        appendFileSync(files.jsonl, redactText(`${JSON.stringify(record)}\n`, secrets));
        const winner = record.outcome === 'seat0' ? record.players[0] : record.outcome === 'seat1' ? record.players[1] : record.outcome;
        log(`arena: seed ${seed}, ${record.players[0]} (seat 0) vs ${record.players[1]} (seat 1): ${winner} (${record.by}) at tick ${record.ticks}`);
      }
    }
  } catch (e) {
    log(`arena: a game could not be played: ${messageOf(e)}`);
    runError = redactText(messageOf(e), secrets);
    code = 1;
  }
  writeFileSync(files.md, redactText(markdownReport(games), secrets));
  // The run is over: the page is told, and the server goes (a signal's cleanup closes it too, idempotently),
  // unless the setup screen owns it: it stays up for the next run.
  if (serve !== null) {
    serve.runFinished();
    if (ownServe) {
      try { await serve.close(); } catch (e) { log(`arena: closing the server: ${messageOf(e)}`); }
      liveServes.delete(serve);
    }
  }
  const t = tally(games);
  print(`arena: ${games.length} game(s) -> ${files.jsonl}`);
  print(`arena: report -> ${files.md}`);
  if (a.judge !== null) {
    const n = (k: JudgeRecord['status']): number => games.filter((g) => g.judge?.status === k).length;
    print(`arena: judge: ${n('scored')} scored, ${n('invalid')} invalid, ${n('failed')} failed, ${n('skipped')} skipped`);
  }
  for (const row of t.values()) {
    print(`  ${row.player}: score ${Number.isNaN(row.score) ? '—' : row.score.toFixed(3)} (${row.wins} won, ${row.draws} drawn, ${row.losses} lost, ${row.voids} void)`);
  }
  const h = headToHead(games, names[0], names[1]);
  print(`  ${h.a} over ${h.b}: n=${h.n}  score=${Number.isNaN(h.score) ? '—' : h.score.toFixed(3)}  p=${pval(h.p)} (one-sided exact binomial, draws half)`);
  let gate: GateVerdict | null = null;
  if (a.gate) {
    // A run that could not finish proves nothing either way: its exit 1 stands.
    if (code !== 0) print(`gate: not judged: the run did not finish (exit ${code})`);
    else {
      gate = gateVerdict(games, names[0], names[1]);
      print(gate.line);
      if (!gate.pass) code = EXIT_GATE_FAIL;
    }
  }
  return { code, games, tally: t, files, gate, ...(runError === undefined ? {} : { error: runError }) };
}

/**
 * `pnpm arena --serve`: the setup screen's server and nothing else (GH-954 W2). It reads the presets file FIRST and
 * refuses to start when the file is readable by group or world; it then serves `/arena` and the control API, and
 * returns with the server still running (the caller's signal handler closes it). A run starts only when the page
 * POSTs one, and it is the same `runArena` that `--watch` uses, on this same server.
 */
async function runServeOnly(o: ServeOnlyArgs, deps: ArenaDeps, log: (line: string) => void, print: (line: string) => void, fail: (code: number, why: string) => ArenaRun): Promise<ArenaRun> {
  let presets: Presets;
  try { presets = deps.presets ?? loadPresets(o.playersFile ?? undefined); } catch (e) { return fail(1, e instanceof PresetsError ? e.message : messageOf(e)); }
  const control: ArenaControl = createArenaControl({
    presets,
    run: (argv, d) => runArena(argv, { ...deps, ...d, onGameEnd: (e) => { deps.onGameEnd?.(e); d.onGameEnd?.(e); } }),
    stop: () => stopRun({ servers: false }),
    rearm,
    argvExtra: [...(o.out === null ? [] : ['--out', o.out]), ...(o.playersFile === null ? [] : ['--players-file', o.playersFile])],
    log,
  });
  let serve: ArenaServe;
  try {
    serve = await (deps.startServe ?? startArenaServe)({ port: o.port, log, routes: control.routes, resultsDir: resolve(process.env.INIT_CWD ?? process.cwd(), o.out ?? 'arena-results'), labelOf: (id) => presets.byId.get(id)?.label ?? null });
  } catch (e) {
    return fail(1, `could not start the arena server: ${messageOf(e)}`);
  }
  control.attach(serve);
  liveServes.add(serve);
  print(`arena: setup: ${serve.url('/arena')}`);
  print(`arena: results: ${serve.url('/arena/results')}`);
  print(`arena: presets: ${[...presets.byId.keys()].join(', ') || 'none'} (${presets.file})`);
  return { code: 0, games: [], tally: null, files: null, gate: null, serving: serve };
}

/**
 * Everything a signal's cleanup does except exit (GH-954 W2): every external child stopped and every seat's temp
 * directory removed (which also sets the stop latch: no game or seat starts after), every running player stopped,
 * every relay closed, and -- unless `servers: false` -- every server this process started closed. The setup
 * screen's Stop calls it with `servers: false` (the server must outlive the run) and then `rearm()`s the latch.
 */
export async function stopRun(o: { servers?: boolean } = {}): Promise<void> {
  const waiting = [...stopWaiters];
  stopWaiters.clear();
  for (const wake of waiting) wake(new Error('the run was stopped'));
  await bounded(abortExternalPlayers(), SIGNAL_STEP_MS);
  await Promise.all([...livePlayers].map((r) => bounded(r.stop(), SIGNAL_STEP_MS)));
  await Promise.all([...liveRelays].map((r) => bounded(r.close({ now: true }), SIGNAL_STEP_MS)));
  if (o.servers !== false) await Promise.all([...liveServes].map((x) => bounded(x.close({ now: true }), SIGNAL_STEP_MS)));
  // No second sweep: the latch the first one set refuses every later seat.
}

/** Lifts the stop latch after a Stop that left the process running. */
export const rearm = (): void => { rearmExternalPlayers(); };

/** The conventional exit for a process ended by a signal: 128 + its number. */
export const SIGNAL_EXIT: Readonly<Record<'SIGINT' | 'SIGTERM', number>> = { SIGINT: 130, SIGTERM: 143 };
/** How long any one step of a signal's cleanup may take before the next runs. */
const SIGNAL_STEP_MS = 5000;

/** Resolves when `p` settles or after `ms`, whichever is first; never rejects. */
function bounded(p: Promise<unknown>, ms: number): Promise<void> {
  return withTimeout(p, ms, 'cleanup').then(() => {}, () => {});
}

/**
 * The CLI's SIGINT/SIGTERM handler: what a skipped `finally` would have
 * done, then `exit(130|143)`. The external children go first and with no
 * grace, their temp directories (each with its 0600 ticket) with them, and
 * the stop latch with them, so no game or seat starts after; then every
 * running player is stopped and every relay closed, each step bounded so a
 * stuck one cannot keep the process alive. The game's own `finally`, if it
 * gets to run, finds everything already stopped (every stop and close is
 * idempotent). A SECOND signal while the cleanup runs exits at once, with the
 * same conventional code, leaving the cleanup unfinished: what a user means by
 * a second Ctrl-C. Returns `signalled()`, which the entry consults so that the
 * run's own exit code never overtakes the signal's, and `uninstall()`.
 */
export function installSignalCleanup(o: { log?: (line: string) => void; exit?: (code: number) => void } = {}): { signalled: () => boolean; uninstall: () => void } {
  const log = o.log ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const exit = o.exit ?? ((code: number) => { process.exit(code); });
  let cleaning: Promise<void> | null = null;
  const onSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (cleaning !== null) {
      log(`arena: second ${signal}: exiting now, cleanup unfinished`);
      exit(SIGNAL_EXIT[signal]);
      return;
    }
    log(`arena: ${signal}: stopping the players, removing the temp directories, closing the relay`);
    cleaning = (async () => {
      await stopRun();
    })().finally(() => { exit(SIGNAL_EXIT[signal]); });
  };
  const onInt = (): void => { onSignal('SIGINT'); };
  const onTerm = (): void => { onSignal('SIGTERM'); };
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  return {
    signalled: () => cleaning !== null,
    uninstall: () => { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); },
  };
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
  const signals = installSignalCleanup();
  runArena(process.argv.slice(2)).then(
    // Once a signal has arrived its handler exits, with its own code.
    // A `--serve` alone has returned with its server still up: only a signal ends that process.
    (r) => { if (!signals.signalled() && r.serving === undefined) process.exit(r.code); },
    (err: unknown) => { process.stderr.write(`arena: ${messageOf(err)}\n`); if (!signals.signalled()) process.exit(1); },
  );
}

/** A by-SIDE board re-indexed by SEAT (LD1: a Sarim host is seat 0 on side 1). */
export function bySeat(score: MatchScore, sides: readonly [0 | 1, 0 | 1]): MatchScore {
  return [score[sides[0]], score[sides[1]]];
}
