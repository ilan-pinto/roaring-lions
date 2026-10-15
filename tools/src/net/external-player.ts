/**
 * External players (N4b task 14): `pnpm arena -- --a "cmd:<template>"` runs a
 * process per game -- a model's command-line client, or anything else that
 * speaks MCP -- and that process drives `pnpm agent` over MCP. The arena never
 * reads a key and adds none: the child runs with the parent's environment as
 * it is, so whatever auth that client uses stays the user's.
 *
 * Per game:
 * - a temp directory, `mkdtemp`, mode 0700, holding three 0600 files: the
 *   seat's `ticket`, the MCP config `mcp.json` naming the harness, and the
 *   standing prompt `prompt.md` (`arena-prompt.md` with the seat filled in);
 * - the template, split by `parseTemplate` (no shell, ever: `shell: false`),
 *   with `{mcp}`, `{prompt}`, `{seat}` and `{code}` filled in per argument;
 *   a standalone `< <path>` makes that file the child's stdin;
 * - the child started in the directory pnpm was run from (`INIT_CWD`, else
 *   the cwd), so a relative path in a template means what it says there;
 * - the child's stdout and stderr appended to the arena's `<game>-<seat>.log`;
 * - `tokens` from the child's LAST stdout line, when it is JSON with
 *   `usage.input_tokens` and `usage.output_tokens` (their sum), else null.
 *   Reported, never scored (decision D7);
 * - the directory removed when the child is gone, in a `finally`, so a throw
 *   anywhere in the game removes it too.
 *
 * The ticket is only ever in the 0600 file: never in an argument (every
 * process on the machine can read argv), the environment, a URL or a log.
 * The harness is named as the absolute `tsx` and the absolute `agent.ts`,
 * not `pnpm --silent agent --`: an MCP client starts its servers from a
 * working directory of its own choosing, where `pnpm` may not find this
 * workspace, and the root script is two pnpm layers (`pnpm --silent --filter
 * @lions/tools agent`) of wrapper processes in front of the one that matters.
 * `--build` and `--origin` are the arena's own, so the harness joins the room
 * the arena opened on the build it opened it with.
 *
 * A child is stopped by its own handle: given `graceMs` to finish by itself
 * (a client that has seen the result prints its usage line and exits), then
 * SIGTERM, then SIGKILL. Its MCP server is ITS child, which goes when its
 * stdin closes.
 *
 * A signal skips every `finally`, so each live seat (its temp directory, and
 * its child once spawned) is also in a module registry, which
 * `abortExternalPlayers` empties with no grace: SIGTERM, then SIGKILL, and the
 * directory removed. The arena's SIGINT/SIGTERM handler calls it. Both it and
 * the `finally` remove with `force`, so whichever runs second finds nothing
 * and does not fail. It also sets a one-way STOP LATCH: from then on a seat is
 * refused before its directory exists (`externalPlayersStopped`), so no seat
 * can start while the cleanup awaits and outlive `process.exit`. A seat's
 * latch check, `mkdtemp`, registration and `spawn` run with no await between
 * them, so a seat is either in the registry the abort sweeps or refused.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { chmodSync, closeSync, createWriteStream, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, type WriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArenaPlayer, PlayerReport, RunningPlayer, SeatStart } from './players';

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

const HERE = dirname(fileURLToPath(import.meta.url));
/** The harness, by absolute path: see the header for why not `pnpm agent`. */
export const HARNESS_TSX = resolve(HERE, '../../node_modules/.bin/tsx');
export const HARNESS_AGENT = join(HERE, 'agent.ts');
const PROMPT_SOURCE = join(HERE, 'arena-prompt.md');

export const PLACEHOLDERS = ['mcp', 'prompt', 'seat', 'code'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export interface ParsedTemplate {
  argv: string[];
  /** The file piped to the child's stdin (`< <path>`), or null. */
  stdinFrom: string | null;
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * A template's arguments. Whitespace separates them; `"..."` and `'...'`
 * group (inside double quotes, `\"` and `\\` are a quote and a backslash);
 * a standalone, unquoted `<` followed by a path pipes that file to stdin.
 * Nothing else is syntax: `$(...)`, backquotes, `;`, `|`, `>`, `&&`, `$VAR`
 * and globs are literal characters of literal arguments. A leading `cmd:` is
 * dropped. Placeholders are checked here and filled by `renderTemplate`.
 */
export function parseTemplate(template: string): ParsedTemplate {
  const s = template.startsWith('cmd:') ? template.slice(4) : template;
  const tokens: { text: string; redirect: boolean }[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && isSpace(s[i])) i++;
    if (i >= s.length) break;
    let text = '';
    let quoted = false;
    while (i < s.length && !isSpace(s[i])) {
      const c = s[i];
      if (c === '"' || c === "'") {
        quoted = true;
        i++;
        while (i < s.length && s[i] !== c) {
          if (c === '"' && s[i] === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) { text += s[i + 1]; i += 2; continue; }
          text += s[i];
          i++;
        }
        if (i >= s.length) throw new Error(`the template has an unclosed ${c === '"' ? 'double' : 'single'} quote`);
        i++;
        continue;
      }
      text += c;
      i++;
    }
    tokens.push({ text, redirect: !quoted && text === '<' });
  }
  const argv: string[] = [];
  let stdinFrom: string | null = null;
  for (let t = 0; t < tokens.length; t++) {
    if (!tokens[t].redirect) { argv.push(tokens[t].text); continue; }
    const next = tokens[t + 1] as { text: string; redirect: boolean } | undefined;
    if (next === undefined || next.redirect) throw new Error('`<` in a template takes a path: `< {prompt}`');
    if (stdinFrom !== null) throw new Error('a template has one stdin: two `<`');
    stdinFrom = next.text;
    t++;
  }
  if (argv.length === 0) throw new Error('the template is empty');
  for (const text of [...argv, ...(stdinFrom === null ? [] : [stdinFrom])]) {
    for (const m of text.matchAll(/\{([A-Za-z_]+)\}/g)) {
      if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) {
        throw new Error(`the template names {${m[1]}}, which is not a placeholder: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`);
      }
    }
  }
  return { argv, stdinFrom };
}

/** `parseTemplate`, then each placeholder filled in INSIDE its argument: a value never splits into two. */
export function renderTemplate(template: string, values: Record<Placeholder, string>): ParsedTemplate {
  const p = parseTemplate(template);
  const fill = (t: string): string => t.replace(/\{([A-Za-z_]+)\}/g, (_, name: string) => values[name as Placeholder]);
  return { argv: p.argv.map(fill), stdinFrom: p.stdinFrom === null ? null : fill(p.stdinFrom) };
}

/** A client's spend, from its last stdout line: `usage.input_tokens + usage.output_tokens`, or null. */
export function tokensOf(lastLine: string): number | null {
  let v: unknown;
  try { v = JSON.parse(lastLine); } catch { return null; }
  const usage = (typeof v === 'object' && v !== null ? (v as { usage?: unknown }).usage : undefined) as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
  if (typeof usage !== 'object' || usage === null) return null;
  const { input_tokens: i, output_tokens: o } = usage;
  if (typeof i !== 'number' || typeof o !== 'number' || !Number.isFinite(i) || !Number.isFinite(o)) return null;
  return i + o;
}

/** The MCP config the child is handed: one server, `lions`, the harness on this seat's ticket FILE. */
export function mcpConfig(s: Pick<SeatStart, 'server' | 'origin' | 'code' | 'build'>, ticketFile: string): { mcpServers: { lions: { command: string; args: string[] } } } {
  return {
    mcpServers: {
      lions: {
        command: HARNESS_TSX,
        args: [HARNESS_AGENT, '--server', s.server, '--code', s.code, '--scope', 'command', '--ticket-file', ticketFile, '--build', s.build, '--origin', s.origin],
      },
    },
  };
}

/** The standing prompt for a seat. In versus the room seats seat s on side s (`match-room.ts`, `side: mode === 'versus' ? seat : 0`). */
export function standingPrompt(s: Pick<SeatStart, 'seat' | 'code'>): string {
  return readFileSync(PROMPT_SOURCE, 'utf8')
    .replaceAll('{side}', String(s.seat))
    .replaceAll('{seat}', String(s.seat))
    .replaceAll('{code}', s.code);
}

export interface ExternalOptions {
  /** Tests record or fail the spawn; default `child_process.spawn`. */
  spawn?: SpawnFn;
  /** How long `stop()` lets the child finish by itself before SIGTERM; default 10 s. */
  graceMs?: number;
  /** After SIGTERM, how long before SIGKILL; default 3 s. */
  killMs?: number;
}

let warnedTmpRoot = false;
/** Where a seat's temp directory is made: `os.tmpdir()`, or `LIONS_ARENA_TMPDIR`.
 *  TEST-ONLY: a spec points it at a directory of its own to watch. It must be
 *  an absolute path; anything else is ignored, with one warning on stderr, so a
 *  ticket never lands somewhere relative to whatever the cwd happens to be. */
export function tempRoot(warn: (line: string) => void = (l) => { process.stderr.write(`${l}\n`); }): string {
  const r = process.env.LIONS_ARENA_TMPDIR;
  if (r === undefined || r === '') return tmpdir();
  if (isAbsolute(r)) return r;
  if (!warnedTmpRoot) {
    warnedTmpRoot = true;
    warn(`arena: LIONS_ARENA_TMPDIR (test-only) must be an absolute path; ignoring ${JSON.stringify(r)}, using ${tmpdir()}`);
  }
  return tmpdir();
}

/** The most of the child's stdout kept for its last line. */
const TAIL_CHARS = 256 * 1024;
/** After the child exits, how long its pipes may take to drain into the log. */
const DRAIN_MS = 2000;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A seat that is still live: its temp directory, and its child once spawned. */
interface LiveSeat { dir: string; child: ChildProcess | null; exited: boolean; exit: Promise<unknown> | null }
const liveSeats = new Set<LiveSeat>();
/** Set, for good, by the first `abortExternalPlayers`: no seat starts after it. */
let stopLatch = false;

/** Whether a signal's cleanup has begun: no new seat, and no new game, may start. */
export function externalPlayersStopped(): boolean {
  return stopLatch;
}

/**
 * Every live external seat ended NOW, for a signal (the arena's handler):
 * each child SIGTERM, then SIGKILL after `killMs`, each temp directory and its
 * ticket removed. Idempotent: a second call, or the seat's own `finally`
 * afterwards, finds nothing left to do. Never throws.
 */
export async function abortExternalPlayers(killMs = 2000): Promise<void> {
  stopLatch = true;
  const seats = [...liveSeats];
  liveSeats.clear();
  await Promise.all(seats.map(async (seat) => {
    const { child } = seat;
    // The directory and its ticket go FIRST, before any wait on the child: a
    // second signal exits mid-wait, and must not leave the ticket on disk.
    try { rmSync(seat.dir, { recursive: true, force: true }); } catch { /* tried again below */ }
    if (child !== null && !seat.exited) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      if (seat.exit !== null) await within(seat.exit, killMs);
      if (!seat.exited) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    }
    // Again: anything the child wrote while it was dying.
    try { rmSync(seat.dir, { recursive: true, force: true }); } catch { /* the finally tries again */ }
  }));
}

/** Resolves after `ms`, or when `p` settles; never keeps the process alive by itself. */
function within(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((res) => {
    const timer = setTimeout(res, ms);
    timer.unref();
    p.then(() => { clearTimeout(timer); res(); }, () => { clearTimeout(timer); res(); });
  });
}

/**
 * `cmd:<template>`: placeholders `{mcp}` (path of an MCP config JSON naming
 * the harness), `{prompt}` (path of the standing prompt), `{seat}`, `{code}`.
 * Run with the parent's env, unchanged. The template is parsed here, so a
 * template the arena cannot run is refused before any room exists.
 */
export function externalPlayer(name: string, template: string, o: ExternalOptions = {}): ArenaPlayer {
  parseTemplate(template);
  const spawn = o.spawn ?? ((command, args, options) => nodeSpawn(command, args, options));
  const graceMs = o.graceMs ?? 10_000;
  const killMs = o.killMs ?? 3000;
  return { name, start: (s) => runExternal(template, s, spawn, graceMs, killMs) };
}

function runExternal(template: string, s: SeatStart, spawn: SpawnFn, graceMs: number, killMs: number): Promise<RunningPlayer> {
  return new Promise<RunningPlayer>((resolveStart, rejectStart) => {
    let resolveDone: (r: PlayerReport) => void = () => {};
    const done = new Promise<PlayerReport>((res) => { resolveDone = res; });

    const life = async (): Promise<PlayerReport> => {
      // The latch, then the directory, then (no await between) the registry and the spawn.
      if (stopLatch) throw new Error('the arena is stopping: no new external seat');
      const dir = mkdtempSync(join(tempRoot(), 'lions-arena-'));
      const seat: LiveSeat = { dir, child: null, exited: false, exit: null };
      liveSeats.add(seat);
      let log: WriteStream | null = null;
      try {
        chmodSync(dir, 0o700);
        const ticketFile = join(dir, 'ticket');
        const mcpFile = join(dir, 'mcp.json');
        const promptFile = join(dir, 'prompt.md');
        // `wx`: a file that is somehow already there is an error, never reused.
        writeFileSync(ticketFile, s.ticket, { mode: 0o600, flag: 'wx' });
        writeFileSync(mcpFile, `${JSON.stringify(mcpConfig(s, ticketFile), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        writeFileSync(promptFile, standingPrompt(s), { mode: 0o600, flag: 'wx' });
        const t = renderTemplate(template, { mcp: mcpFile, prompt: promptFile, seat: String(s.seat), code: s.code });
        if (s.logFile !== undefined) {
          const file = s.logFile;
          log = createWriteStream(file, { flags: 'a', mode: 0o600 });
          // A log that cannot be written loses the log, never the game (an unheard 'error' would throw).
          log.on('error', (e) => { process.stderr.write(`arena: the log ${file} could not be written: ${messageOf(e)}\n`); });
        }

        // A relative `< path` means what it says where the child starts (INIT_CWD, else the cwd).
        const childCwd = process.env.INIT_CWD ?? process.cwd();
        const stdin = t.stdinFrom === null ? null : openSync(resolve(childCwd, t.stdinFrom), 'r');
        let child: ChildProcess;
        try {
          child = spawn(t.argv[0], t.argv.slice(1), {
            shell: false,
            // The parent's environment, as it is: the arena adds nothing to it.
            env: process.env,
            cwd: childCwd,
            stdio: [stdin ?? 'ignore', 'pipe', 'pipe'],
          });
        } finally {
          // The child holds its own copy of the descriptor now.
          if (stdin !== null) closeSync(stdin);
        }
        let tail = '';
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
          log?.write(chunk);
          tail = (tail + chunk).slice(-TAIL_CHARS);
        });
        child.stderr?.on('data', (chunk: Buffer) => { log?.write(chunk); });
        let exited = false;
        let stoppedByUs = false;
        const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
          child.once('exit', (code, signal) => { exited = true; seat.exited = true; res({ code, signal }); });
        });
        seat.child = child;
        seat.exit = exit;
        // `close` also waits on the pipes, which a grandchild may still hold; `exit` is the child.
        const closed = new Promise<void>((res) => { child.once('close', () => { res(); }); });
        await new Promise<void>((res, rej) => {
          child.once('spawn', () => { res(); });
          child.once('error', (e) => { rej(new Error(`the external player did not start (${t.argv[0]}): ${messageOf(e)}`)); });
        });

        let stopping: Promise<void> | null = null;
        resolveStart({
          client: null,
          done,
          stop: () => {
            stopping ??= (async () => {
              if (!exited) await within(exit, graceMs);
              if (!exited) {
                stoppedByUs = true;
                child.kill('SIGTERM');
                await within(exit, killMs);
              }
              if (!exited) child.kill('SIGKILL');
              await done;
            })();
            return stopping;
          },
        });

        const { code, signal } = await exit;
        await within(closed, DRAIN_MS);
        child.stdout?.destroy();
        child.stderr?.destroy();
        const errors: string[] = [];
        if (!stoppedByUs && signal !== null) errors.push(`killed by ${signal}`);
        else if (!stoppedByUs && code !== 0) errors.push(`exited with code ${String(code)}`);
        const lines = tail.trimEnd().split('\n');
        return { tokens: tokensOf(lines[lines.length - 1] ?? ''), timeouts: 0, errors };
      } finally {
        if (log !== null) {
          const l = log;
          await new Promise<void>((res) => { l.end(res); });
        }
        liveSeats.delete(seat);
        rmSync(dir, { recursive: true, force: true });
      }
    };

    life().then(
      (report) => { resolveDone(report); },
      (e: unknown) => {
        // Before the child started, this rejects `start`; after, `start` has
        // resolved and the error is the report's.
        rejectStart(e instanceof Error ? e : new Error(String(e)));
        resolveDone({ tokens: null, timeouts: 0, errors: [messageOf(e)] });
      },
    );
  });
}
