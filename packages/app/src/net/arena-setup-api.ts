/**
 * The arena setup screen's requests (GH-954 W2), kept apart from `watch-connect.ts` and from every seat path: this
 * page creates no room and holds no ticket. DEV only: reached through `ui/arena-setup.ts`, itself reached only by a
 * dynamic `import()` inside `import.meta.env.DEV` in `main.ts`.
 *
 * - The run's key comes from the URL FRAGMENT (`keyFromHash`, `watch-connect.ts`), is held in memory and goes out
 *   as `x-arena-token`. The browser adds the `Origin` header to a POST itself.
 * - `startRun` is the ONE place the optional private API token travels: in the JSON body of that one POST, to
 *   127.0.0.1, and nowhere else (never a URL, a header, storage, or a value this module keeps). The request body
 *   is built, sent and dropped inside the call; a refusal is reported as a CODE, never a value.
 * - Every answer is validated into a named shape (`parsePlayers`, `parseStatus`): a field the server did not name is
 *   dropped, and anything that is not that shape is a refusal, so a page can only show what it recognises.
 */
import type { Matchup } from '@lions/net';

export type PlayerKind = 'scripted' | 'model' | 'judge' | 'model_judge';
export interface PlayerRow { id: string; label: string; kind: PlayerKind }

/** A start request: exactly the fields the server takes. `token` is the optional private API token. */
export interface StartRequest {
  a: string;
  b: string;
  map: string;
  matchup: Matchup;
  /** `annihilation`, or a win mode the lobby offers on this map and matchup (GH-976 P3). Absent is annihilation. */
  mode?: string;
  seeds: number;
  pace: number;
  roundWallMs: number;
  capTicks: number;
  judge?: string;
  token?: string;
}

/** What a model said it spent. A cache or cost field is null where it did not say. */
export interface UsageView {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
}

export type RunState = 'idle' | 'running' | 'stopping' | 'done' | 'stopped' | 'failed';
export interface StatusGameView { n: number; outcome: string; by: string; ticks: number; players: [string, string]; usage: [UsageView | null, UsageView | null] }
export interface StatusView {
  state: RunState;
  run: { a: string; b: string; map: string; matchup: string; mode: string; seeds: number; judge: string | null; withToken: boolean } | null;
  game: { n: number; of: number } | null;
  games: StatusGameView[];
  totals: { players: { player: string; usage: UsageView }[]; judge: UsageView | null; all: UsageView | null } | null;
  error: string | null;
}

/** The server refused or could not answer. `status` 0: no answer at all. `code` is the server's error code, if any. */
export class SetupRefused extends Error {
  constructor(readonly status: number, readonly code: string | null = null) {
    super(`the arena server refused: HTTP ${status}${code === null ? '' : ` ${code}`}`);
    this.name = 'SetupRefused';
  }
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const KINDS: readonly string[] = ['scripted', 'model', 'judge', 'model_judge'];
const STATES: readonly string[] = ['idle', 'running', 'stopping', 'done', 'stopped', 'failed'];

export function parsePlayers(raw: unknown): PlayerRow[] | null {
  if (!isRec(raw) || !Array.isArray(raw.players)) return null;
  const out: PlayerRow[] = [];
  for (const p of raw.players) {
    if (!isRec(p) || !isStr(p.id) || p.id === '' || !isStr(p.label) || !isStr(p.kind) || !KINDS.includes(p.kind)) return null;
    out.push({ id: p.id, label: p.label, kind: p.kind as PlayerKind });
  }
  return out;
}

function usageOf(v: unknown): UsageView | null {
  if (!isRec(v) || !isNum(v.inputTokens) || !isNum(v.outputTokens)) return null;
  return { inputTokens: v.inputTokens, outputTokens: v.outputTokens, cacheCreationInputTokens: numOrNull(v.cacheCreationInputTokens), cacheReadInputTokens: numOrNull(v.cacheReadInputTokens), costUsd: numOrNull(v.costUsd) };
}

export function parseStatus(raw: unknown): StatusView | null {
  if (!isRec(raw) || !isStr(raw.state) || !STATES.includes(raw.state)) return null;
  let run: StatusView['run'] = null;
  if (isRec(raw.run)) {
    const r = raw.run;
    if (!isStr(r.a) || !isStr(r.b) || !isStr(r.map) || !isStr(r.matchup) || !isNum(r.seeds)) return null;
    run = { a: r.a, b: r.b, map: r.map, matchup: r.matchup, mode: isStr(r.mode) ? r.mode : 'annihilation', seeds: r.seeds, judge: isStr(r.judge) ? r.judge : null, withToken: r.withToken === true };
  }
  const games: StatusGameView[] = [];
  if (Array.isArray(raw.games)) {
    for (const g of raw.games) {
      if (!isRec(g) || !isNum(g.n) || !isStr(g.outcome) || !isStr(g.by) || !isNum(g.ticks) || !Array.isArray(g.players) || g.players.length !== 2 || !g.players.every(isStr)) return null;
      const u = Array.isArray(g.usage) ? g.usage : [];
      games.push({ n: g.n, outcome: g.outcome, by: g.by, ticks: g.ticks, players: [g.players[0] as string, g.players[1] as string], usage: [usageOf(u[0]), usageOf(u[1])] });
    }
  }
  let totals: StatusView['totals'] = null;
  if (isRec(raw.totals)) {
    const t = raw.totals;
    const players = (Array.isArray(t.players) ? t.players : []).flatMap((p) => {
      if (!isRec(p) || !isStr(p.player)) return [];
      const usage = usageOf(p.usage);
      return usage === null ? [] : [{ player: p.player, usage }];
    });
    totals = { players, judge: usageOf(t.judge), all: usageOf(t.all) };
  }
  return {
    state: raw.state as RunState, run,
    game: isRec(raw.game) && isNum(raw.game.n) && isNum(raw.game.of) ? { n: raw.game.n, of: raw.game.of } : null,
    games, totals, error: isStr(raw.error) ? raw.error : null,
  };
}

interface CallDeps { fetch: typeof fetch; key: string; signal?: AbortSignal }

async function call(deps: CallDeps, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await deps.fetch(path, {
      method, cache: 'no-store',
      headers: { 'x-arena-token': deps.key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch {
    throw new SetupRefused(0);
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* an empty or non-JSON body is just no detail */ }
  return { status: res.status, json };
}

const codeOf = (json: unknown): string | null => (isRec(json) && isStr(json.error) ? json.error : null);

export async function fetchPlayers(deps: CallDeps): Promise<PlayerRow[]> {
  const r = await call(deps, 'GET', '/arena/api/players');
  if (r.status !== 200) throw new SetupRefused(r.status, codeOf(r.json));
  const players = parsePlayers(r.json);
  if (players === null) throw new SetupRefused(0);
  return players;
}

export async function fetchStatus(deps: CallDeps): Promise<StatusView> {
  const r = await call(deps, 'GET', '/arena/api/status');
  if (r.status !== 200) throw new SetupRefused(r.status, codeOf(r.json));
  const s = parseStatus(r.json);
  if (s === null) throw new SetupRefused(0);
  return s;
}

/** Starts a run. Resolves on the server's 202; rejects `SetupRefused` with its status and error CODE (400, 409...). */
export async function startRun(deps: CallDeps, request: StartRequest): Promise<void> {
  const r = await call(deps, 'POST', '/arena/api/start', request);
  if (r.status !== 202) throw new SetupRefused(r.status, codeOf(r.json));
}

export async function stopRun(deps: CallDeps): Promise<RunState> {
  const r = await call(deps, 'POST', '/arena/api/stop', {});
  if (r.status !== 200) throw new SetupRefused(r.status, codeOf(r.json));
  const state = isRec(r.json) && isStr(r.json.state) && STATES.includes(r.json.state) ? (r.json.state as RunState) : null;
  if (state === null) throw new SetupRefused(0);
  return state;
}
