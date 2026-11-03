/**
 * The arena's judge (GH-973, the lead's ruling of 3 Nov): `pnpm arena --judge
 * "cmd:<template>"` scores BOTH players of every finished game with a THIRD
 * model, on the rubric in `match-score.ts`.
 *
 * The template is the players' own form (`external-player.ts`): split by
 * `parseTemplate`, never through a shell, run with this process's environment
 * unchanged. The arena never reads a key and adds none; whatever sign-in the
 * judge's client uses stays the user's, and a key in a template would be
 * written into the results, so none belongs there. Placeholders:
 *
 * - `{prompt}`: the judge's prompt (the rubric, what the stats mean, the
 *   referee's stats for both seats with the event timeline, the reply format).
 *   `< {prompt}` as its own token makes it the child's stdin.
 * - `{stats}`: the same stats alone, as JSON, for a client that wants a file.
 *
 * There is no MCP config: the judge plays nothing and sees nothing of the
 * match but the referee's numbers. It runs in its own temp directory (0700,
 * files 0600, removed when it ends and on a signal: it is in the same
 * registry as the players), so it carries none of this repository's context;
 * use absolute paths in a template. Its stdout and stderr go to
 * `<out>/<game>-judge.log`. It has `timeoutMs` (SIGTERM, then SIGKILL).
 *
 * Its reply is parsed by `parseScoreReply`, strictly. The outcome is a
 * `JudgeRecord` and is never a number the judge did not give: a client that
 * fails, times out, answers something else or an out-of-range score is
 * `failed` or `invalid` with the reason. A judge never fails a game and never
 * changes its result (D7): `runJudge` does not throw.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { chmodSync, closeSync, createWriteStream, mkdtempSync, openSync, rmSync, writeFileSync, type WriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { externalPlayersStopped, renderTemplate, tempRoot, tokensOf, trackLiveSeat, type LiveSeat, type SpawnFn } from './external-player';
import { clientReply, judgePrompt, parseScoreReply, type RefereeStats, type ScoreSet } from './match-score';

export const JUDGE_PLACEHOLDERS = ['prompt', 'stats'] as const;

/** What the judge made of one game. Absent from a record: not judged. */
export type JudgeRecord =
  | { status: 'scored'; scores: ScoreSet; tokens: number | null }
  /** It answered, and the answer is not a valid score (out of range, a criterion missing, a reason that is not one line...). */
  | { status: 'invalid'; problems: string[]; tokens: number | null }
  /** It gave no answer: could not start, exited non-zero, timed out, reported an error, or the arena was stopping. */
  | { status: 'failed'; reason: string; tokens: number | null }
  /** It was not asked: a void game has no result to judge. */
  | { status: 'skipped'; reason: string };

export interface JudgeJob {
  /** `cmd:<template>`, already checked by `parseTemplate(template, JUDGE_PLACEHOLDERS)`. */
  template: string;
  stats: RefereeStats;
  /** The two players' names, BY SEAT. */
  players: readonly [string, string];
  /** The game's outcome in words (the arena's verdict). */
  outcome: string;
  /** Where the judge's stdout and stderr are appended. */
  logFile?: string;
  /** How long the judge may take. */
  timeoutMs: number;
  /** Tests record or fake the spawn; default `child_process.spawn`. */
  spawn?: SpawnFn;
  /** After SIGTERM, how long before SIGKILL; default 3 s. */
  killMs?: number;
}

/** The most of the judge's stdout kept: a reply is a few KiB; more is not a reply. */
const MAX_STDOUT = 1024 * 1024;
const DRAIN_MS = 2000;
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const failed = (reason: string, tokens: number | null = null): JudgeRecord => ({ status: 'failed', reason, tokens });

/** Resolves after `ms`, or when `p` settles; never keeps the process alive. */
function within(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((res) => {
    const timer = setTimeout(res, ms);
    timer.unref();
    p.then(() => { clearTimeout(timer); res(); }, () => { clearTimeout(timer); res(); });
  });
}

/** Runs the judge on one game. Never throws, and always cleans up its directory. */
export async function runJudge(j: JudgeJob): Promise<JudgeRecord> {
  // A signal's cleanup has begun: nothing new starts (the players' own latch).
  if (externalPlayersStopped()) return failed('the arena is stopping (a signal): no judge started');
  const spawn = j.spawn ?? ((command, args, options) => nodeSpawn(command, args, options));
  const killMs = j.killMs ?? 3000;
  let dir: string;
  try {
    dir = mkdtempSync(join(tempRoot(), 'lions-judge-'));
  } catch (e) {
    return failed(`no temp directory for the judge (${messageOf(e)})`);
  }
  const seat: LiveSeat = { dir, child: null, exited: false, exit: null };
  const untrack = trackLiveSeat(seat);
  let log: WriteStream | null = null;
  try {
    chmodSync(dir, 0o700);
    const promptFile = join(dir, 'prompt.md');
    const statsFile = join(dir, 'stats.json');
    writeFileSync(promptFile, judgePrompt(j.stats, j.players, j.outcome), { mode: 0o600, flag: 'wx' });
    writeFileSync(statsFile, `${JSON.stringify(j.stats, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const t = renderTemplate(j.template, { prompt: promptFile, stats: statsFile }, JUDGE_PLACEHOLDERS);
    if (j.logFile !== undefined) {
      const file = j.logFile;
      log = createWriteStream(file, { flags: 'a', mode: 0o600 });
      log.on('error', (e) => { process.stderr.write(`arena: the log ${file} could not be written: ${messageOf(e)}\n`); });
    }
    // The judge starts in its own directory: no project context for the model, and a relative `<` means that directory.
    const stdin = t.stdinFrom === null ? null : openSync(resolve(dir, t.stdinFrom), 'r');
    let child: ChildProcess;
    try {
      child = spawn(t.argv[0], t.argv.slice(1), { shell: false, env: process.env, cwd: dir, stdio: [stdin ?? 'ignore', 'pipe', 'pipe'] });
    } finally {
      if (stdin !== null) closeSync(stdin);
    }
    let out = '';
    let overflow = false;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      log?.write(chunk);
      if (out.length + chunk.length > MAX_STDOUT) { overflow = true; return; }
      out += chunk;
    });
    child.stderr?.on('data', (chunk: Buffer) => { log?.write(chunk); });
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
      child.once('exit', (code, signal) => { seat.exited = true; res({ code, signal }); });
    });
    const closed = new Promise<void>((res) => { child.once('close', () => { res(); }); });
    seat.child = child;
    seat.exit = exit;
    try {
      await new Promise<void>((res, rej) => {
        child.once('spawn', () => { res(); });
        child.once('error', (e) => { rej(e); });
      });
    } catch (e) {
      return failed(`the judge did not start (${t.argv[0]}): ${messageOf(e)}`);
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      const k = setTimeout(() => { if (!seat.exited) { try { child.kill('SIGKILL'); } catch { /* already gone */ } } }, killMs);
      k.unref();
    }, j.timeoutMs);
    timer.unref();
    const { code, signal } = await exit;
    clearTimeout(timer);
    await within(closed, DRAIN_MS);
    child.stdout?.destroy();
    child.stderr?.destroy();
    const lines = out.trimEnd().split('\n');
    const tokens = tokensOf(lines[lines.length - 1] ?? '');
    if (timedOut) return failed(`the judge did not finish in ${Math.round(j.timeoutMs / 1000)} s`, tokens);
    if (signal !== null) return failed(`the judge was killed by ${signal}`, tokens);
    if (code !== 0) return failed(`the judge exited with code ${String(code)}`, tokens);
    if (overflow) return failed(`the judge printed more than ${MAX_STDOUT} bytes`, tokens);
    const reply = clientReply(out);
    if (reply.isError) return failed(`the judge's client reported an error: ${reply.text.replace(/\s+/g, ' ').slice(0, 160)}`, tokens);
    const v = parseScoreReply(reply.text);
    return v.ok ? { status: 'scored', scores: v.scores, tokens } : { status: 'invalid', problems: v.problems, tokens };
  } catch (e) {
    return failed(messageOf(e));
  } finally {
    if (log !== null) {
      const l = log;
      await new Promise<void>((res) => { l.end(res); });
    }
    untrack();
    rmSync(dir, { recursive: true, force: true });
  }
}
