/**
 * The results and replay screens' two requests (GH-954 W3): `GET /arena/api/results` and `GET
 * /arena/api/replay?game=<file name>` on the arena server that served this page. DEV only: reached through
 * `ui/arena-results.ts` and `ui/arena-replay.ts`, themselves behind a dynamic `import()` inside `import.meta.env.DEV`
 * in `main.ts`.
 *
 * The shapes below are the SERVER's too (`tools/src/net/arena-results.ts` imports them as types), so a field cannot be
 * renamed on one side only. The key comes from the URL fragment, is held in memory and goes out as `x-arena-token`.
 * The file name sent to `replay` is one the results list handed out, and the server checks it again against the
 * directory (a name, never a path). Every answer is validated into a named shape: a field the server did not name is
 * dropped, and anything that is not that shape is a refusal.
 */
import { parseReplay, ReplayRefused, serializeReplay, type ReplayDigest, type ReplayFile } from './replay-file';

export interface UsageBody { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number | null; cacheReadInputTokens: number | null; costUsd: number | null }
export interface JudgeBody {
  status: 'scored' | 'invalid' | 'failed' | 'skipped';
  /** Present when scored: each seat's overall score and each criterion's, 1 to 10. */
  scores?: { overall: [number, number]; criteria: Record<string, [number, number]> };
}
export interface DigestBody {
  referee: ReplayDigest;
  /** The independent sim's digest from the file's own text, when the arena took it. */
  watcher: ReplayDigest | null;
  /** The watcher and the referee ended in the same tick and state; null when there is no watcher digest. */
  agree: boolean | null;
}
export interface GameBody {
  n: number;
  /** The frames file's name, when this game has one: the only thing a replay is asked for. */
  file: string | null;
  /** By seat; null: an external player whose name is not shown. */
  players: [string | null, string | null];
  map: string;
  matchup: string;
  outcome: string;
  by: string;
  ticks: number;
  judge: JudgeBody | null;
  usage: [UsageBody | null, UsageBody | null];
  judgeUsage: UsageBody | null;
  /** The players' and the judge's cost together; null when nobody said. */
  costUsd: number | null;
  digest: DigestBody | null;
  /** The file was recorded on the build the server runs; null when there is no file or its header cannot be read. */
  buildMatches: boolean | null;
}
export interface RunBody {
  id: string;
  games: GameBody[];
  totals: { players: { player: string | null; usage: UsageBody }[]; judge: UsageBody | null; all: UsageBody | null };
  costUsd: number | null;
}
export interface ResultsBody {
  build: string;
  criteria: { id: string; label: string }[];
  runs: RunBody[];
}

/** The server refused or could not answer. `status` 0: no answer at all. `code` is the server's error code, if any. */
export class ResultsRefused extends Error {
  constructor(readonly status: number, readonly code: string | null = null, readonly detail: { fileBuild?: string | null; build?: string } = {}) {
    super(`the arena server refused: HTTP ${status}${code === null ? '' : ` ${code}`}`);
    this.name = 'ResultsRefused';
  }
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const strOrNull = (v: unknown): string | null => (isStr(v) ? v : null);

function usageOf(v: unknown): UsageBody | null {
  if (!isRec(v) || !isNum(v.inputTokens) || !isNum(v.outputTokens)) return null;
  return { inputTokens: v.inputTokens, outputTokens: v.outputTokens, cacheCreationInputTokens: numOrNull(v.cacheCreationInputTokens), cacheReadInputTokens: numOrNull(v.cacheReadInputTokens), costUsd: numOrNull(v.costUsd) };
}
function digestOf(v: unknown): ReplayDigest | null {
  return isRec(v) && isInt(v.tick) && isInt(v.hash) ? { tick: v.tick, hash: v.hash } : null;
}
function pair(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) ? [v[0], v[1]] : null;
}
const STATUSES: readonly string[] = ['scored', 'invalid', 'failed', 'skipped'];

function judgeOf(v: unknown): JudgeBody | null {
  if (!isRec(v) || !isStr(v.status) || !STATUSES.includes(v.status)) return null;
  const status = v.status as JudgeBody['status'];
  if (status !== 'scored' || !isRec(v.scores)) return { status };
  const overall = pair(v.scores.overall);
  if (overall === null || !isRec(v.scores.criteria)) return { status };
  const criteria: Record<string, [number, number]> = {};
  for (const [id, p] of Object.entries(v.scores.criteria)) {
    const sc = pair(p);
    if (sc !== null) criteria[id] = sc;
  }
  return { status, scores: { overall, criteria } };
}

function gameOf(g: unknown): GameBody | null {
  if (!isRec(g) || !isInt(g.n) || !isStr(g.map) || !isStr(g.matchup) || !isStr(g.outcome) || !isStr(g.by) || !isInt(g.ticks)) return null;
  if (!Array.isArray(g.players) || g.players.length !== 2 || !g.players.every((p) => p === null || isStr(p))) return null;
  const u = Array.isArray(g.usage) ? g.usage : [];
  let digest: DigestBody | null = null;
  if (isRec(g.digest)) {
    const referee = digestOf(g.digest.referee);
    if (referee !== null) digest = { referee, watcher: digestOf(g.digest.watcher), agree: typeof g.digest.agree === 'boolean' ? g.digest.agree : null };
  }
  return {
    n: g.n, file: strOrNull(g.file), players: [strOrNull(g.players[0]), strOrNull(g.players[1])],
    map: g.map, matchup: g.matchup, outcome: g.outcome, by: g.by, ticks: g.ticks,
    judge: judgeOf(g.judge), usage: [usageOf(u[0]), usageOf(u[1])], judgeUsage: usageOf(g.judgeUsage),
    costUsd: numOrNull(g.costUsd), digest, buildMatches: typeof g.buildMatches === 'boolean' ? g.buildMatches : null,
  };
}

export function parseResults(raw: unknown): ResultsBody | null {
  if (!isRec(raw) || !isStr(raw.build) || !Array.isArray(raw.runs) || !Array.isArray(raw.criteria)) return null;
  const criteria: ResultsBody['criteria'] = [];
  for (const c of raw.criteria) {
    if (!isRec(c) || !isStr(c.id) || !isStr(c.label)) return null;
    criteria.push({ id: c.id, label: c.label });
  }
  const runs: RunBody[] = [];
  for (const r of raw.runs) {
    if (!isRec(r) || !isStr(r.id) || !Array.isArray(r.games) || !isRec(r.totals)) return null;
    const games: GameBody[] = [];
    for (const g of r.games) {
      const game = gameOf(g);
      if (game === null) return null;
      games.push(game);
    }
    const players = (Array.isArray(r.totals.players) ? r.totals.players : []).flatMap((p) => {
      const usage = isRec(p) ? usageOf(p.usage) : null;
      return isRec(p) && usage !== null ? [{ player: strOrNull(p.player), usage }] : [];
    });
    runs.push({ id: r.id, games, totals: { players, judge: usageOf(r.totals.judge), all: usageOf(r.totals.all) }, costUsd: numOrNull(r.costUsd) });
  }
  return { build: raw.build, criteria, runs };
}

interface CallDeps { fetch: typeof fetch; key: string; signal?: AbortSignal }

async function get(deps: CallDeps, path: string): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await deps.fetch(path, { method: 'GET', cache: 'no-store', headers: { 'x-arena-token': deps.key }, ...(deps.signal ? { signal: deps.signal } : {}) });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ResultsRefused(0);
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* an empty or non-JSON body is just no detail */ }
  return { status: res.status, json };
}

const codeOf = (json: unknown): string | null => (isRec(json) && isStr(json.error) ? json.error : null);

export async function fetchResults(deps: CallDeps): Promise<ResultsBody> {
  const r = await get(deps, '/arena/api/results');
  if (r.status !== 200) throw new ResultsRefused(r.status, codeOf(r.json));
  const body = parseResults(r.json);
  if (body === null) throw new ResultsRefused(0);
  return body;
}

/** A game's recorded file. `name` is a file name from the results list. Rejects `ResultsRefused` for the server's
 *  refusals (409 `build_mismatch` names both builds) and for a file that does not check out here; a `ReplayRefused`
 *  from the file's own checks is reported as code `bad_file`. */
export async function fetchReplay(deps: CallDeps, name: string): Promise<{ build: string; file: string; replay: ReplayFile }> {
  const r = await get(deps, `/arena/api/replay?game=${encodeURIComponent(name)}`);
  if (r.status !== 200) {
    const detail = isRec(r.json) ? { fileBuild: strOrNull(r.json.fileBuild), ...(isStr(r.json.build) ? { build: r.json.build } : {}) } : {};
    throw new ResultsRefused(r.status, codeOf(r.json), detail);
  }
  if (!isRec(r.json) || !isStr(r.json.build) || !isStr(r.json.file) || !isRec(r.json.replay)) throw new ResultsRefused(0);
  const { build, file } = r.json;
  try {
    // The file is checked again here, with the same reader the server used and the build the server named.
    return { build, file, replay: parseReplay(serializeReplay(r.json.replay as unknown as ReplayFile), { build }) };
  } catch (e) {
    if (e instanceof ReplayRefused) throw new ResultsRefused(422, e.code, { fileBuild: e.detail.fileBuild ?? null, build });
    throw new ResultsRefused(422, 'bad_file', { build });
  }
}
