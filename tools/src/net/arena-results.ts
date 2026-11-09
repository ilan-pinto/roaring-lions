/**
 * The results the arena server shows and replays (GH-954 W3): `GET /arena/api/results` lists the runs under the
 * results directory with their games, and `GET /arena/api/replay?game=<file name>` returns one game's frames file.
 * Both are registered on the arena server (`arena-serve.ts`), so both meet its Host, Origin and `x-arena-token`
 * checks before this module is called.
 *
 * What a response carries, and what it never does:
 * - players are DISPLAY NAMES (`displayName`): a scripted name, a preset's label, an id-shaped name; a `cmd:`
 *   template, a path or anything with a space is `null` and the page says "an external player". No template, token
 *   or command line is read from a file and sent; the judge's REASONS are not sent either, only its numbers.
 * - cost is what the clients said they spent (`usageOf`), per game and per run, summed by `sumUsage`; never scored.
 *
 * File names (`resolveFramesFile`). The replay route takes a NAME from the results list and never a path:
 *  1. the name must have the shape of a frames file: letters, digits, `_ . -`, no leading dot, ending in
 *     `.frames.jsonl` -- so `../x`, `/etc/passwd`, `a/b`, a backslash, a NUL and every other file in the directory
 *     (`.md`, `.log`, `.jsonl`) fail here (`name`);
 *  2. it must be, exactly, an entry of the directory's own listing and a regular file, not a link (`not_listed`).
 * The path handed to `readFileSync` is then `join(dir, entry)` of that listing's entry, never of the request.
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, fstatSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseReplay, ReplayRefused } from '../../../packages/app/src/net/replay-file';
import type { ReplayDigest, ReplayEnd } from '../../../packages/app/src/net/replay-file';
// The bodies are the page's own types, so a field cannot be renamed on one side only.
import type { GameBody, JudgeBody, ResultsBody, RunBody, UsageBody } from '../../../packages/app/src/net/arena-results-api';
import type { ApiRoute } from './arena-serve';
import { displayName } from './arena-frames';
import { runFieldsOf } from './arena-record';
import { sumUsage, usageTotals, type GameRecord } from './arena-score';
import type { Usage } from './external-player';
import { CRITERIA } from './match-score';

/** The name of a frames file: no slash, no leading dot, no escape. */
export const FRAMES_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,159}\.frames\.jsonl$/;
/** The newest runs listed: a results directory grows without end. */
export const MAX_RUNS = 40;
/** The largest results `.jsonl` or frames file read. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 8 * 1024;

export type FramesNameRefusal = 'name' | 'not_listed';

/** Whether `name` is a frames file in `dir`; the path to read if so. Pure over the directory's listing, so a spec
 *  can ask it without a request. */
export function resolveFramesFile(dir: string, name: unknown): { ok: true; path: string; name: string } | { ok: false; why: FramesNameRefusal } {
  if (typeof name !== 'string' || !FRAMES_NAME.test(name)) return { ok: false, why: 'name' };
  let entry: string | undefined;
  try { entry = readdirSync(dir).find((n) => n === name); } catch { return { ok: false, why: 'not_listed' }; }
  if (entry === undefined) return { ok: false, why: 'not_listed' };
  const path = join(resolve(dir), entry);
  try {
    // A link could lead anywhere: only a regular file that is itself in the directory.
    if (!lstatSync(path).isFile()) return { ok: false, why: 'not_listed' };
  } catch { return { ok: false, why: 'not_listed' }; }
  return { ok: true, path, name: entry };
}

// ---------------------------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------------------------

export type { GameBody, JudgeBody, ResultsBody, RunBody, UsageBody };

const usageBody = (u: Usage | null | undefined): UsageBody | null => (u == null ? null : { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheCreationInputTokens: u.cacheCreationInputTokens, cacheReadInputTokens: u.cacheReadInputTokens, costUsd: u.costUsd });

/** The first and last lines of a file, by reading its two ends only. */
function ends(path: string): { head: string; tail: string } | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    if (size === 0 || size > MAX_FILE_BYTES) return null;
    const headBuf = Buffer.alloc(Math.min(size, HEAD_BYTES));
    readSync(fd, headBuf, 0, headBuf.length, 0);
    const tailLen = Math.min(size, TAIL_BYTES);
    const tailBuf = Buffer.alloc(tailLen);
    readSync(fd, tailBuf, 0, tailLen, size - tailLen);
    const head = headBuf.toString('utf8').split('\n')[0];
    const tailLines = tailBuf.toString('utf8').split('\n').filter((l) => l !== '');
    return { head, tail: tailLines[tailLines.length - 1] ?? '' };
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const digestOf = (v: unknown): ReplayDigest | null => (typeof v === 'object' && v !== null && isInt((v as ReplayDigest).tick) && isInt((v as ReplayDigest).hash) ? { tick: (v as ReplayDigest).tick, hash: (v as ReplayDigest).hash } : null);

/** What a frames file says of itself without reading all of it: its build and its end line's digests. */
export function peekFrames(path: string): { build: string | null; end: Pick<ReplayEnd, 'referee' | 'watcher'> | null } {
  const e = ends(path);
  if (e === null) return { build: null, end: null };
  let build: string | null = null;
  try {
    const h = JSON.parse(e.head) as { kind?: unknown; build?: unknown };
    if (h.kind === 'header' && typeof h.build === 'string') build = h.build;
  } catch { /* an unreadable header is an unknown build */ }
  let end: Pick<ReplayEnd, 'referee' | 'watcher'> | null = null;
  try {
    const t = JSON.parse(e.tail) as { kind?: unknown; referee?: unknown; watcher?: unknown };
    const referee = t.kind === 'end' ? digestOf(t.referee) : null;
    if (referee !== null) end = { referee, watcher: digestOf(t.watcher) };
  } catch { /* a file with no end line has no digests */ }
  return { build, end };
}

export interface ResultsOptions {
  dir: string;
  /** The build this server runs (`buildId()`). */
  build: () => string;
  /** A preset id to its label. */
  labelOf?: (id: string) => string | null;
}

function judgeBody(j: GameRecord['judge']): JudgeBody | null {
  if (j === undefined) return null;
  if (j.status !== 'scored') return { status: j.status };
  const criteria: Record<string, [number, number]> = {};
  // A record from before a criterion existed may lack it: it is left out, never a 500 for the whole list.
  for (const c of CRITERIA) {
    const [a, b] = [j.scores.seat0?.criteria?.[c.id]?.score, j.scores.seat1?.criteria?.[c.id]?.score];
    if (typeof a === 'number' && typeof b === 'number') criteria[c.id] = [a, b];
  }
  const [oa, ob] = [j.scores.seat0?.overall?.score, j.scores.seat1?.overall?.score];
  if (typeof oa !== 'number' || typeof ob !== 'number') return { status: 'scored' };
  return { status: 'scored', scores: { overall: [oa, ob], criteria } };
}

function recordsOf(path: string): GameRecord[] {
  let text: string;
  try {
    const st = lstatSync(path);
    // A link could lead anywhere: only a regular file that is itself in the directory.
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return [];
    text = readFileSync(path, 'utf8');
  } catch { return []; }
  const out: GameRecord[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    try {
      const r = JSON.parse(line) as GameRecord;
      // A record that is half written (the run is going) or from some other tool is skipped, never guessed at.
      if (Array.isArray(r.players) && r.players.length === 2 && typeof r.outcome === 'string' && Array.isArray(r.reports)) out.push(r);
    } catch { /* a half-written last line */ }
  }
  return out;
}

/** Every run under `dir`, newest first, each game with the file that replays it. */
export function listResults(o: ResultsOptions): ResultsBody {
  const build = o.build();
  let names: string[];
  try { names = readdirSync(o.dir); } catch { names = []; }
  const have = new Set(names);
  const ids = new Map<string, string>();
  const bases = names.filter((n) => n.endsWith('.jsonl') && !n.endsWith('.frames.jsonl')).map((n) => n.slice(0, -'.jsonl'.length)).sort().reverse().slice(0, MAX_RUNS);
  const show = (name: string): string | null => displayName(name, o.labelOf);
  const runs: RunBody[] = [];
  const perDate = new Map<string, number>();
  for (const base of [...bases].reverse()) {
    // The run's id is its date and its place that day, never its file name: an older results directory may hold names
    // that were made from a command line.
    const date = /^\d{4}-\d{2}-\d{2}/.exec(base)?.[0] ?? 'run';
    const nth = (perDate.get(date) ?? 0) + 1;
    perDate.set(date, nth);
    ids.set(base, `${date}-${nth}`);
  }
  for (const base of bases) {
    const records = recordsOf(join(o.dir, `${base}.jsonl`));
    if (records.length === 0) continue;
    const games: GameBody[] = records.map((r, i) => {
      const frames = `${base}-game${i + 1}.frames.jsonl`;
      const file = have.has(frames) && resolveFramesFile(o.dir, frames).ok ? frames : null;
      const peek = file === null ? null : peekFrames(join(o.dir, file));
      const judgeUsage = r.judge === undefined || r.judge.status === 'skipped' ? undefined : r.judge.usage;
      const spent = sumUsage([r.reports[0]?.usage, r.reports[1]?.usage, judgeUsage]);
      const watcher = peek?.end?.watcher ?? null;
      const referee = peek?.end?.referee ?? null;
      return {
        n: i + 1, file,
        players: [show(r.players[0]), show(r.players[1])],
        map: r.map, matchup: r.matchup, outcome: r.outcome, by: r.by, ticks: r.ticks,
        judge: judgeBody(r.judge),
        usage: [usageBody(r.reports[0]?.usage), usageBody(r.reports[1]?.usage)],
        judgeUsage: usageBody(judgeUsage),
        costUsd: spent?.costUsd ?? null,
        digest: referee === null ? null : { referee, watcher, agree: watcher === null ? null : watcher.tick === referee.tick && watcher.hash === referee.hash },
        buildMatches: peek?.build == null ? null : peek.build === build,
        // GH-954 P1: from the record itself, all five or null (an older record). Never read from the frames file or guessed.
        terms: runFieldsOf(r),
      };
    });
    const t = usageTotals(records);
    runs.push({
      id: ids.get(base) ?? base, games,
      totals: { players: t.byPlayer.map((p) => ({ player: show(p.player), usage: usageBody(p.usage) as UsageBody })), judge: usageBody(t.judge), all: usageBody(t.all) },
      costUsd: t.all?.costUsd ?? null,
    });
  }
  return { build, criteria: CRITERIA.map((c) => ({ id: c.id, label: c.label })), runs };
}

/** The two routes, for `ArenaServeOptions.routes`' sibling in `arena-serve.ts`. */
export function resultsRoutes(o: ResultsOptions): Record<string, ApiRoute> {
  return {
    results: { method: 'GET', handle: () => ({ status: 200, body: listResults(o) }) },
    replay: {
      method: 'GET',
      handle: (req) => {
        const name = new URL(req.url ?? '/', 'http://x').searchParams.get('game');
        const found = resolveFramesFile(o.dir, name);
        if (!found.ok) return found.why === 'name' ? { status: 400, body: { error: 'bad_name' } } : { status: 404, body: { error: 'not_found' } };
        const build = o.build();
        let text: string;
        try {
          if (lstatSync(found.path).size > MAX_FILE_BYTES) return { status: 413, body: { error: 'too_big' } };
          text = readFileSync(found.path, 'utf8');
        } catch { return { status: 404, body: { error: 'not_found' } }; }
        try {
          return { status: 200, body: { build, file: found.name, replay: parseReplay(text, { build }) } };
        } catch (e) {
          if (e instanceof ReplayRefused) {
            if (e.code === 'build_mismatch') return { status: 409, body: { error: 'build_mismatch', fileBuild: e.detail.fileBuild ?? null, build } };
            return { status: 422, body: { error: e.code } };
          }
          return { status: 500, body: { error: 'read' } };
        }
      },
    },
  };
}
