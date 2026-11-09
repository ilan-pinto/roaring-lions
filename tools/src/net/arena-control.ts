/**
 * The setup screen's control API (GH-954 W2): `GET /arena/api/players`, `POST /arena/api/start`, `POST
 * /arena/api/stop`, `GET /arena/api/status`, registered on the arena server (`arena-serve.ts`) behind its Host,
 * Origin and `x-arena-token` checks. One run at a time.
 *
 * What a start body may say, and nothing else (`parseStartBody`, pure):
 *
 *     {a, b, map, matchup, mode?, seeds, pace, roundWallMs, capTicks, judge?, token?}
 *
 * `a` and `b` are `passive`, `rush` or a preset id with a player template; `judge` a preset id with a judge
 * template; `mode` (GH-976 P3) is `annihilation` or a win mode, and the Worker's own question (`refusalOf`) decides whether
 * that mode is offered on the map and matchup, so the screen can list only what the lobby lists and the server still refuses
 * anything else. Any other field (a `template` above all) is a 400, and so is anything that `parseArgs` or `refusalOf`
 * would refuse. The body becomes an argv for the SAME `runArena` the command line uses (always `--watch`, so the
 * page can watch it); this module runs no game itself. A start while a run is going is a 409. Stop runs the
 * caller's `stop()` (`stopRun`, a signal's cleanup without the exit), waits for the run to end, and re-arms.
 *
 * The private token (D-W6 as amended, 3 Nov). `token` is optional and is the only secret this module ever holds:
 * - it arrives as a POST body field, on 127.0.0.1, behind the three checks above, and nowhere else (never a URL,
 *   a header, a query);
 * - it is held in memory, in ONE variable (`active.env`), for the run that was started with it;
 * - it reaches the run's children as the environment variable `ANTHROPIC_API_KEY` (and the judge's), through
 *   `ArenaDeps.env`; `runArena` redacts it from every line it logs or prints and from the results files, and the
 *   children's log streams are redacted as they are written (`redact.ts`);
 * - no response body carries it or any template (`status` and `players` are built from named fields, never from
 *   the request, a preset or an error message), and an error names a CODE, never a value;
 * - it is deleted when the run ends, for any reason (`finish`), and a run started without one has none.
 *
 * Pure but for the run it starts: records in, JSON out.
 */
import { MATCHUPS } from '@lions/net';
import type { ArenaDeps, ArenaRun } from './arena';
import { parseArgs, refusalOf } from './arena';
import { modeFlag } from './win-rule';
import type { ApiRoute, ArenaServe } from './arena-serve';
import { sumUsage, usageTotals, type GameRecord, type UsageSum, type UsageTotals } from './arena-score';
import { catalogueOf, presetSpec, SCRIPTED, type Presets } from './arena-presets';
import type { Usage } from './external-player';
import { redactText } from './redact';

/** The variable a run's private token reaches its children as. Fixed: the body names no variable. */
export const TOKEN_ENV = 'ANTHROPIC_API_KEY';
const MAP_ID = /^[a-z0-9_]{1,48}$/;
/** A token is 8-512 of `[A-Za-z0-9._~+/=-]`: every key shape in use, and no character that JSON escapes (`"`, `\`),
 *  that a shell or an env entry could split on, or that a redactor could miss in a serialised copy. */
const TOKEN_SHAPE = /^[A-Za-z0-9._~+/=-]{8,512}$/;
const FIELDS = ['a', 'b', 'map', 'matchup', 'mode', 'seeds', 'pace', 'roundWallMs', 'capTicks', 'judge', 'token'] as const;
const NUMBERS = [['seeds', '--seeds'], ['pace', '--pace'], ['roundWallMs', '--round-wall-ms'], ['capTicks', '--cap-ticks']] as const;
/** The bound on how long Stop waits for the run to end before it answers anyway. */
const STOP_WAIT_MS = 20_000;

export type StartRefusal =
  | 'body' | 'unknown_field' | 'bad_player' | 'bad_judge' | 'bad_map' | 'map_refused' | 'bad_matchup' | 'bad_mode' | 'bad_number' | 'bad_token' | 'bad_args';

export type StartParse =
  | { ok: true; argv: string[]; token: string | null; run: RunSummary }
  | { ok: false; error: StartRefusal; detail?: string };

/** What the screen is told about the run it started (never the token, a template or a path). */
export interface RunSummary {
  a: string;
  b: string;
  map: string;
  matchup: string;
  /** `annihilation`, or the win mode the run plays (GH-976 P3). */
  mode: string;
  seeds: number;
  pace: number;
  roundWallMs: number;
  capTicks: number;
  judge: string | null;
  /** Whether a token was supplied: a fact, not the value. */
  withToken: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A start body as an argv, or the code of what is wrong with it. Pure. */
export function parseStartBody(body: unknown, presets: Presets, argvExtra: readonly string[] = []): StartParse {
  if (!isObj(body)) return { ok: false, error: 'body' };
  for (const k of Object.keys(body)) if (!(FIELDS as readonly string[]).includes(k)) return { ok: false, error: 'unknown_field' };
  const playerOk = (v: unknown): v is string => typeof v === 'string' && ((SCRIPTED as readonly string[]).includes(v) || presets.byId.get(v)?.template != null);
  const { a, b, map, matchup, mode, judge, token } = body;
  if (!playerOk(a) || !playerOk(b)) return { ok: false, error: 'bad_player' };
  if (judge !== undefined && judge !== null && (typeof judge !== 'string' || presets.byId.get(judge)?.judgeTemplate == null)) return { ok: false, error: 'bad_judge' };
  if (typeof map !== 'string' || !MAP_ID.test(map)) return { ok: false, error: 'bad_map' };
  if (typeof matchup !== 'string' || !(MATCHUPS as readonly string[]).includes(matchup)) return { ok: false, error: 'bad_matchup' };
  if (mode !== undefined && mode !== null && (typeof mode !== 'string' || modeFlag(mode) === undefined)) return { ok: false, error: 'bad_mode' };
  if (token !== undefined && token !== null && (typeof token !== 'string' || !TOKEN_SHAPE.test(token))) return { ok: false, error: 'bad_token' };
  const spec = (id: string): string => ((SCRIPTED as readonly string[]).includes(id) ? id : presetSpec(id));
  const argv = ['--a', spec(a), '--b', spec(b), '--map', map, '--matchup', matchup];
  // `annihilation` is the default and names nothing: the run is argv-identical to one started before modes existed.
  if (typeof mode === 'string' && mode !== 'annihilation') argv.push('--mode', mode);
  for (const [field, flag] of NUMBERS) {
    const v = body[field];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, error: 'bad_number' };
    argv.push(flag, String(v));
  }
  if (typeof judge === 'string') argv.push('--judge', presetSpec(judge));
  argv.push('--watch', ...argvExtra);
  // The arena's own parser has the last word on ranges, the matchup and the map: nothing is judged twice.
  const parsed = parseArgs(argv);
  if ('error' in parsed) return { ok: false, error: 'bad_args', detail: parsed.error.split('\n')[0] };
  if (refusalOf(parsed.map, parsed.matchup) !== null) return { ok: false, error: 'map_refused' };
  // GH-976 P3: a mode the lobby would not offer on this map and matchup is refused here too, whatever the screen listed.
  if (parsed.winMode !== undefined && refusalOf(parsed.map, parsed.matchup, parsed.winMode) !== null) return { ok: false, error: 'bad_mode' };
  return {
    ok: true, argv, token: typeof token === 'string' ? token : null,
    run: { a, b, map: parsed.map, matchup: parsed.matchup, mode: parsed.winMode ?? 'annihilation', seeds: parsed.seeds, pace: parsed.pace, roundWallMs: parsed.roundWallMs, capTicks: parsed.capTicks, judge: typeof judge === 'string' ? judge : null, withToken: typeof token === 'string' },
  };
}

export type RunState = 'idle' | 'running' | 'stopping' | 'done' | 'stopped' | 'failed';

/** One finished game, as `status` reports it: the verdict and what each player said it spent. */
export interface StatusGame {
  n: number;
  outcome: string;
  by: string;
  ticks: number;
  players: [string, string];
  usage: [Usage | null, Usage | null];
}

/** `GET /arena/api/status`. */
export interface StatusBody {
  state: RunState;
  run: RunSummary | null;
  /** The game in progress, 1-based, and the run's total; null before the first and after the last. */
  game: { n: number; of: number } | null;
  games: StatusGame[];
  /** Spend per player, the judge's, and all together: reported, never scored (D7). */
  totals: { players: { player: string; usage: UsageSum }[]; judge: UsageSum | null; all: UsageSum | null } | null;
  /** Why a run that did not finish ended, in one line; null otherwise. */
  error: string | null;
}

export interface ArenaControlOptions {
  presets: Presets;
  /** Plays one run: the real `runArena`, or a spec's stub. `deps.serve`, `deps.presets` and `deps.env` are the control's. */
  run(argv: string[], deps: ArenaDeps): Promise<ArenaRun>;
  /** Ends the run now (`stopRun({ servers: false })`). */
  stop(): Promise<void>;
  /** Lifts the stop latch once a stopped run has ended. */
  rearm(): void;
  /** How long Stop waits for the run to end before it answers `stopping` anyway; default 20 s. */
  stopWaitMs?: number;
  /** Appended to every run's argv (the CLI's `--out`, a spec's temp directory): never from a request. */
  argvExtra?: readonly string[];
  log?: (line: string) => void;
}

export interface ArenaControl {
  routes: Record<string, ApiRoute>;
  /** The server the runs use (known only once it is listening). */
  attach(serve: ArenaServe): void;
  status(): StatusBody;
  /** For a spec: whether the private token is still held anywhere in this module. */
  holdsToken(): boolean;
  /** Resolves when the run in progress (if any) has ended and been recorded. */
  idle(): Promise<void>;
}

const toStatusGame = (g: GameRecord, n: number): StatusGame => ({
  n, outcome: g.outcome, by: g.by, ticks: g.ticks, players: [g.players[0], g.players[1]],
  usage: [g.reports[0].usage ?? null, g.reports[1].usage ?? null],
});

const totalsOf = (t: UsageTotals): NonNullable<StatusBody['totals']> | null => (t.byPlayer.length === 0 && t.judge === null ? null : { players: t.byPlayer, judge: t.judge, all: t.all });

export function createArenaControl(o: ArenaControlOptions): ArenaControl {
  const log = o.log ?? ((s: string) => { process.stderr.write(`${s}\n`); });
  let serve: ArenaServe | null = null;
  let state: RunState = 'idle';
  let summary: RunSummary | null = null;
  let games: StatusGame[] = [];
  let records: GameRecord[] = [];
  let totalGames = 0;
  let error: string | null = null;
  let running: Promise<void> = Promise.resolve();
  let stopRequested = false;
  /** The ONE place a private token lives: the environment the run's children are handed. Deleted by `finish`. */
  let active: { env: Record<string, string> } | null = null;

  const status = (): StatusBody => {
    const done = state === 'done' || state === 'stopped' || state === 'failed';
    return {
      state, run: summary,
      game: state === 'running' || state === 'stopping' ? { n: Math.min(games.length + 1, totalGames), of: totalGames } : null,
      games,
      totals: totalsOf(usageTotals(records)),
      error: done || state === 'stopping' ? error : null,
    };
  };

  const finish = (r: ArenaRun | null, thrown: unknown, secrets: readonly string[]): void => {
    // The token goes first, whatever else happens below: resolved, rejected, code 1 or stopped.
    if (active !== null) { for (const k of Object.keys(active.env)) delete active.env[k]; active = null; }
    if (r !== null) {
      records = r.games;
      games = r.games.map((g, i) => toStatusGame(g, i + 1));
      error = r.error ?? null;
      state = stopRequested ? 'stopped' : r.code === 0 ? 'done' : 'failed';
    } else {
      // A raw throw is not redacted by `runArena`: it is here, with the token this run was started with.
      error = redactText(thrown instanceof Error ? thrown.message : String(thrown), secrets);
      state = stopRequested ? 'stopped' : 'failed';
    }
    // The latch a Stop set is lifted only once the run it stopped has ended (never under a live run).
    if (stopRequested) o.rearm();
  };

  const start = (body: unknown): { status: number; body: unknown } => {
    const v = parseStartBody(body, o.presets, o.argvExtra);
    if (!v.ok) return { status: 400, body: { error: v.error, ...(v.detail === undefined ? {} : { detail: v.detail }) } };
    if (serve === null) return { status: 503, body: { error: 'not_ready' } };
    if (state === 'running' || state === 'stopping') return { status: 409, body: { error: 'busy' } };
    stopRequested = false;
    summary = v.run;
    games = [];
    records = [];
    error = null;
    totalGames = v.run.seeds * 2;
    state = 'running';
    active = v.token === null ? null : { env: { [TOKEN_ENV]: v.token } };
    const deps: ArenaDeps = {
      serve, presets: o.presets,
      ...(active === null ? {} : { env: active.env }),
      onGameEnd: (e) => { games = [...games, toStatusGame(e.record, e.n)]; records = [...records, e.record]; },
    };
    const secrets = v.token === null ? [] : [v.token];
    running = o.run(v.argv, deps).then((r) => { finish(r, null, secrets); }, (e: unknown) => { finish(null, e, secrets); });
    return { status: 202, body: { state: 'running', run: summary } };
  };

  const stop = async (): Promise<{ status: number; body: unknown }> => {
    if (state !== 'running') return { status: 200, body: { state } };
    stopRequested = true;
    state = 'stopping';
    try {
      await o.stop();
      await Promise.race([running, new Promise<void>((res) => { setTimeout(res, o.stopWaitMs ?? STOP_WAIT_MS).unref(); })]);
    } catch (e) {
      log(`arena: stopping the run: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { status: 200, body: { state } };
  };

  const noFields = (body: unknown): boolean => isObj(body) && Object.keys(body).length === 0;

  return {
    routes: {
      players: { method: 'GET', handle: () => ({ status: 200, body: { players: catalogueOf(o.presets) } }) },
      status: { method: 'GET', handle: () => ({ status: 200, body: status() }) },
      start: { method: 'POST', handle: (_req, body) => start(body) },
      stop: { method: 'POST', handle: (_req, body) => (noFields(body) ? stop() : { status: 400, body: { error: 'unknown_field' } }) },
    },
    attach: (s) => { serve = s; },
    status,
    holdsToken: () => active !== null,
    idle: () => running,
  };
}

// Re-exported so a spec names what it checks against.
export { sumUsage };
