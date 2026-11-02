/**
 * `pnpm bot` (GH-954): one command to play against a model-driven bot.
 *
 *   pnpm bot -- --room ABC123 --model sonnet
 *
 * Open a versus room in the browser, then run that. It is the four manual
 * steps of `docs/net/N4-agent.md` §2 in one: it makes a temp directory (0700),
 * writes the MCP config that starts THIS checkout's harness with
 * `--scope command --join` on the room (0600) and the standing prompt for
 * seat 1 (0600), runs `claude -p --model <id> --mcp-config <file>
 * --output-format json --allowedTools mcp__lions__*` with the prompt as its
 * stdin, reports the result and the token use, and removes the directory on
 * every way out.
 *
 * Nothing here reads, stores or prints a key: the client runs with this
 * process's environment, unchanged, so whatever sign-in it uses stays the
 * user's. There is no ticket to protect either: `--join` asks the room for the
 * free seat inside the harness, so no ticket is ever in an argument, a file, a
 * URL or a log. The client is started with `shell: false`, in the temp
 * directory (so it carries no project context of this repository), and its
 * `--client` value is split by `parseTemplate`, which treats every shell
 * metacharacter as a literal one.
 *
 * `--output-format json` makes the client print ONE result object when it is
 * done, so the live part of the progress is the client's stderr and any plain
 * stdout line; the result and the tokens (`tokensOf`) come at the end.
 *
 * Signals (the arena's rule, `arena.ts#installSignalCleanup`): the first
 * SIGINT/SIGTERM removes the directory, stops the client (SIGTERM, then
 * SIGKILL after `killMs`) and ends with 130/143; a second one removes the
 * directory again and exits at once.
 *
 * Exit codes: 0 played to its end, 2 the room refused the build, 1 any other
 * failure or a usage error, 130/143 a signal.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { chmodSync, closeSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HARNESS_AGENT, HARNESS_TSX, parseTemplate, standingPrompt, tempRoot, tokensOf, type SpawnFn } from './external-player';

/** The live game: the default `--server`. */
export const LIVE_SERVER = 'https://roaring-lions.pint12.workers.dev';

/** `--model` aliases; any other value is passed through as a full model id. */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  haiku: 'claude-haiku-5-5',
};

export const USAGE = 'usage: pnpm bot -- --room <code> [--model sonnet|opus|haiku|<model id>] [--server <url>] [--callsign <name>] [--client <cmd>]';
const VALUED = new Set(['room', 'model', 'server', 'callsign', 'client']);
/** What the client may be asked to call: the harness's tools, and nothing else. */
const ALLOWED_TOOLS = 'mcp__lions__*';

export interface BotArgs {
  room: string;
  /** The id handed to the client's `--model`. */
  model: string;
  server: string;
  callsign: string;
  /** The client command, already split: `['claude']` by default. */
  client: string[];
}

const httpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** A model flag's id: an alias is its id; anything else is taken as the id itself. */
export function resolveModel(v: string): { id: string; alias: string | null } {
  const key = v.toLowerCase();
  return Object.prototype.hasOwnProperty.call(MODEL_ALIASES, key) ? { id: MODEL_ALIASES[key], alias: key } : { id: v, alias: null };
}

const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The command line, or what is wrong with it (always with the usage line). */
export function parseBotArgs(argv: readonly string[]): BotArgs | { error: string } {
  const got = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;   // pnpm passes the separator through
    if (!arg.startsWith('--')) return { error: `unexpected argument "${arg}"\n${USAGE}` };
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    if (!VALUED.has(name)) return { error: `unknown option --${name}\n${USAGE}` };
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[i + 1];
    if (eq < 0) i++;
    if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) return { error: `--${name} needs a value\n${USAGE}` };
    got.set(name, value);
  }
  const room = got.get('room');
  if (room === undefined) return { error: `--room is required\n${USAGE}` };
  // The code goes into an argument and into the prompt: letters and digits only.
  if (!/^[A-Za-z0-9]{4,12}$/.test(room)) return { error: `--room is the room's code (letters and digits), as the lobby shows it\n${USAGE}` };
  const server = got.get('server') ?? LIVE_SERVER;
  if (!httpUrl(server)) return { error: `--server is the game's http(s) URL\n${USAGE}` };
  const { id, alias } = resolveModel(got.get('model') ?? 'sonnet');
  let client: string[];
  try {
    const t = parseTemplate(got.get('client') ?? 'claude');
    if (t.stdinFrom !== null) return { error: `--client is a command, not a redirect\n${USAGE}` };
    client = t.argv;
  } catch (e) {
    return { error: `--client: ${e instanceof Error ? e.message : String(e)}\n${USAGE}` };
  }
  return {
    room: room.toUpperCase(),
    model: id,
    server,
    callsign: got.get('callsign') ?? `${alias === null ? 'Claude' : capitalised(alias)} Bot`,
    client,
  };
}

/** The MCP config the client is handed: the harness of THIS checkout, joining `room` as a command-scope bot. */
export function botMcpConfig(a: Pick<BotArgs, 'server' | 'room' | 'callsign'>): { mcpServers: { lions: { command: string; args: string[] } } } {
  return {
    mcpServers: {
      lions: {
        command: HARNESS_TSX,
        // `--build` and `--origin` are left to the harness: this checkout's build, the server's own origin.
        args: [HARNESS_AGENT, '--server', a.server, '--code', a.room, '--scope', 'command', '--join', '--callsign', a.callsign],
      },
    },
  };
}

/** The client's arguments after the command itself. */
export function clientArgs(a: Pick<BotArgs, 'model' | 'client'>, mcpFile: string): string[] {
  return [...a.client.slice(1), '-p', '--model', a.model, '--mcp-config', mcpFile, '--output-format', 'json', '--allowedTools', ALLOWED_TOOLS];
}

export type Failure = 'auth' | 'build' | 'room';

/** Which known failure a client's output (and its stderr) describes, or null. */
export function classify(output: string): Failure | null {
  if (/failed to authenticate|oauth (?:session|token) (?:has )?expired|authentication_error|invalid api key|please run \/login|not logged in/i.test(output)) return 'auth';
  if (/build_mismatch|\bexit(?:ed)?(?: with)?(?: code)? 2\b/i.test(output)) return 'build';
  if (/refused the join: HTTP (?:400|404|409|410)\b|\bHTTP (?:400|404|409|410)\b|room (?:is )?full/i.test(output)) return 'room';
  return null;
}

/** What to tell the player about a known failure. */
export function failureMessage(f: Failure, a: Pick<BotArgs, 'server'>): string {
  switch (f) {
    case 'build':
      return [
        `bot: the live site (${a.server}) runs a different build than this checkout, and a room never plays two builds against each other.`,
        '  Read the commit in the game\'s Settings footer, then run `pnpm bot` from a checkout at that commit:',
        '    git worktree add --detach ../roaring-lions-bot <commit> && cd ../roaring-lions-bot && pnpm install',
      ].join('\n');
    case 'room':
      return 'bot: the room is full, closed or not found. Open a new room in the game (Play with a friend -> Open a room) and run `pnpm bot` with its code.';
    case 'auth':
      return [
        'bot: the client could not sign in. Run `claude`, type /login, and run `pnpm bot` again from macOS Terminal',
        '  rather than inside the Claude desktop app: inside the app, the inherited CLAUDE_CODE_* / ANTHROPIC_BASE_URL environment breaks a child CLI.',
      ].join('\n');
  }
}

export const ENTRYPOINT_WARNING = 'bot: CLAUDE_CODE_ENTRYPOINT is set, so this shell was started by Claude Code (or its desktop app). The environment it passes on can break a child `claude`; if the bot cannot sign in, run `pnpm bot` from macOS Terminal.';

/** The conventional exit for a process ended by a signal: 128 + its number. */
export const SIGNAL_EXIT: Readonly<Record<'SIGINT' | 'SIGTERM', number>> = { SIGINT: 130, SIGTERM: 143 };

export interface SignalSource {
  on(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
  off(signal: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
}

export interface BotOptions {
  /** Tests inject a fake; default `child_process.spawn`. */
  spawn?: SpawnFn;
  /** Default `process.env`, passed on unchanged. */
  env?: NodeJS.ProcessEnv;
  /** Where SIGINT/SIGTERM come from; default `process`. */
  signals?: SignalSource;
  /** What a second signal calls; default `process.exit`. */
  exit?: (code: number) => void;
  /** Progress and messages (stderr); default `process.stderr`. */
  log?: (line: string) => void;
  /** The result text (stdout); default `process.stdout`. */
  print?: (line: string) => void;
  /** After SIGTERM, how long before SIGKILL; default 3 s. */
  killMs?: number;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** The most of the client's output kept for classification and its last line. */
const TAIL_CHARS = 256 * 1024;
/** After the client exits, how long its pipes may take to drain. */
const DRAIN_MS = 2000;

/** The result object of `--output-format json`: the last line of stdout that is one. */
function resultOf(lastLine: string): { result: string | null; isError: boolean } | null {
  let v: unknown;
  try { v = JSON.parse(lastLine); } catch { return null; }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { result?: unknown; is_error?: unknown };
  return { result: typeof o.result === 'string' ? o.result : null, isError: o.is_error === true };
}

/** The bot, from a command line. Resolves to the exit code; never calls `process.exit` itself except through a second signal. */
export async function runBot(argv: readonly string[], o: BotOptions = {}): Promise<number> {
  const log = o.log ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const print = o.print ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const spawn = o.spawn ?? ((command, args, options) => nodeSpawn(command, args, options));
  const env = o.env ?? process.env;
  const signals: SignalSource = o.signals ?? process;
  const exit = o.exit ?? ((code: number) => { process.exit(code); });
  const killMs = o.killMs ?? 3000;

  const a = parseBotArgs(argv);
  if ('error' in a) { log(a.error); return 1; }
  if (env.CLAUDE_CODE_ENTRYPOINT !== undefined && env.CLAUDE_CODE_ENTRYPOINT !== '') log(ENTRYPOINT_WARNING);

  const dir = mkdtempSync(join(tempRoot(), 'lions-bot-'));
  let child: ChildProcess | null = null;
  let childGone = false;
  let signalled: 'SIGINT' | 'SIGTERM' | null = null;
  let killTimer: NodeJS.Timeout | null = null;
  const removeDir = (): void => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* the finally tries again */ } };
  const onSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (signalled !== null) {
      removeDir();
      log(`bot: second ${signal}: exiting now`);
      exit(SIGNAL_EXIT[signal]);
      return;
    }
    signalled = signal;
    log(`bot: ${signal}: stopping the client and removing ${dir}`);
    removeDir();
    if (child !== null && !childGone) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      const c = child;
      killTimer = setTimeout(() => { if (!childGone) { try { c.kill('SIGKILL'); } catch { /* already gone */ } } }, killMs);
      killTimer.unref();
    }
  };
  const onInt = (): void => { onSignal('SIGINT'); };
  const onTerm = (): void => { onSignal('SIGTERM'); };
  signals.on('SIGINT', onInt);
  signals.on('SIGTERM', onTerm);

  try {
    chmodSync(dir, 0o700);
    const mcpFile = join(dir, 'mcp.json');
    const promptFile = join(dir, 'prompt.md');
    // `wx`: a file that is somehow already there is an error, never reused.
    writeFileSync(mcpFile, `${JSON.stringify(botMcpConfig(a), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    writeFileSync(promptFile, standingPrompt({ seat: 1, code: a.room }), { mode: 0o600, flag: 'wx' });

    const command = a.client[0];
    const stdin = openSync(promptFile, 'r');
    try {
      child = spawn(command, clientArgs(a, mcpFile), {
        shell: false,
        // The parent's environment, as it is: nothing added, nothing read.
        env,
        // The temp directory: no project context of this repository for the model.
        cwd: dir,
        stdio: [stdin, 'pipe', 'pipe'],
      });
    } finally {
      // The client holds its own copy of the descriptor now.
      closeSync(stdin);
    }
    const live = child;
    let out = '';
    let errOut = '';
    let held = '';
    const last: { result: string | null } = { result: null };
    const line = (l: string): void => {
      if (l.trim() === '') return;
      // The one JSON result object is held for the end; anything else is progress.
      if (resultOf(l) !== null) last.result = l; else { print(l); out += `${l}\n`; }
    };
    live.stdout?.setEncoding('utf8');
    live.stdout?.on('data', (chunk: string) => {
      held += chunk;
      let nl = held.indexOf('\n');
      while (nl >= 0) { line(held.slice(0, nl)); held = held.slice(nl + 1); nl = held.indexOf('\n'); }
    });
    live.stderr?.setEncoding('utf8');
    live.stderr?.on('data', (chunk: string) => {
      log(chunk.replace(/\n$/, ''));
      errOut = (errOut + chunk).slice(-TAIL_CHARS);
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
      live.once('exit', (code, sig) => { childGone = true; res({ code, signal: sig }); });
    });
    const closed = new Promise<void>((res) => { live.once('close', () => { res(); }); });
    try {
      await new Promise<void>((res, rej) => {
        live.once('spawn', () => { res(); });
        live.once('error', (e) => { rej(e); });
      });
    } catch (e) {
      log(`bot: could not start the client "${command}": ${messageOf(e)}. Install Claude Code, or name the command with --client.`);
      return 1;
    }
    log(`bot: ${a.callsign} (${a.model}) is joining room ${a.room} on ${a.server}; Ctrl-C stops it`);
    // If a signal landed before the child existed, stop it now.
    if (signalled !== null) { try { live.kill('SIGTERM'); } catch { /* gone */ } }

    const { code, signal } = await exited;
    await Promise.race([closed, new Promise<void>((res) => { const t = setTimeout(res, DRAIN_MS); t.unref(); })]);
    live.stdout?.destroy();
    live.stderr?.destroy();
    if (held.trim() !== '') line(held);
    if (killTimer !== null) clearTimeout(killTimer);

    if (signalled !== null) return SIGNAL_EXIT[signalled];

    const parsed = last.result === null ? null : resultOf(last.result);
    const all = `${out}\n${errOut}\n${parsed?.result ?? ''}`;
    const failed = code !== 0 || signal !== null || parsed?.isError === true;
    if (failed) {
      const known = classify(all);
      if (known !== null) {
        log(failureMessage(known, a));
        return known === 'build' ? 2 : 1;
      }
      log(`bot: the client ${signal !== null ? `was killed by ${signal}` : `exited with code ${String(code)}`}${parsed?.result != null ? `: ${parsed.result}` : ''}`);
      const tail = all.trim().split('\n').slice(-10).join('\n');
      if (tail !== '' && parsed?.result == null) log(tail);
      return 1;
    }
    // A clean exit can still carry a known refusal in the harness's words.
    const known = classify(errOut);
    if (known === 'build') { log(failureMessage(known, a)); return 2; }
    const tokens = last.result === null ? null : tokensOf(last.result);
    print(parsed?.result ?? '(the client printed no result)');
    log(`bot: finished. tokens: ${tokens === null ? 'unknown' : String(tokens)}`);
    return 0;
  } finally {
    signals.off('SIGINT', onInt);
    signals.off('SIGTERM', onTerm);
    if (killTimer !== null) clearTimeout(killTimer);
    removeDir();
  }
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
  runBot(process.argv.slice(2)).then(
    (code) => { process.exit(code); },
    (err: unknown) => { process.stderr.write(`bot: ${messageOf(err)}\n`); process.exit(1); },
  );
}
