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
 * Every run writes two files to `bot-results/` (git-ignored) under the directory
 * pnpm was run from (`INIT_CWD`), never outside it: `<date>-<room>-<model>.log`,
 * the harness's and the client's stderr and stdout, each line timestamped (never
 * the environment; there is no ticket), and `<date>-<room>-<model>-report.md`,
 * the model's final message under a header (room, model, server, build, result,
 * tokens), or the reason there is none. The model is asked for that message by
 * `BOT_ADDENDUM`, appended here to the standing prompt; `arena-prompt.md`, which
 * the arena also reads, is not touched. Both paths print at the start and the end.
 *
 * `--output-format json` makes the client print ONE result object when it is
 * done, so the live part of the progress is the client's stderr and any plain
 * stdout line; the result and the tokens (`tokensOf`) come at the end.
 *
 * Signals (the arena's rule, `arena.ts#installSignalCleanup`): the first
 * SIGINT/SIGTERM/SIGHUP (the terminal closing) removes the directory, stops the client (SIGTERM, then
 * SIGKILL after `killMs`) and ends with 130/143; a second one removes the
 * directory again and exits at once.
 *
 * Exit codes: 0 played to its end, 2 the room refused the build, 1 any other
 * failure or a usage error, 130/143 a signal.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_CALLSIGN_CHARS } from '@lions/net';
import { joinRoom, JoinRefused } from './agent';
import { buildId } from './build-id';
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
  const callsign = got.get('callsign');
  if (callsign !== undefined && Array.from(callsign).length > MAX_CALLSIGN_CHARS) return { error: `--callsign is at most ${MAX_CALLSIGN_CHARS} characters, the room's limit\n${USAGE}` };
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
    callsign: callsign ?? `${alias === null ? 'Claude' : capitalised(alias)} Bot`,
    client,
  };
}

/**
 * The MCP config the client is handed: the harness of THIS checkout, playing
 * the seat `pnpm bot` joined for it. The ticket is in `ticketFile` (0600, in the
 * temp directory), never in an argument. `logFile` is the bot's own log: the
 * harness is the client's child, so bot.ts sees neither its exit code nor its
 * stderr, and this is how a refusal reaches us. `--build` and `--origin` are
 * left to the harness: this checkout's build (`build`, when given, so the join
 * and the hello name the same string), the server's own origin.
 */
export function botMcpConfig(a: Pick<BotArgs, 'server' | 'room'>, ticketFile: string, logFile: string, build?: string): { mcpServers: { lions: { command: string; args: string[] } } } {
  return {
    mcpServers: {
      lions: {
        command: HARNESS_TSX,
        args: [HARNESS_AGENT, '--server', a.server, '--code', a.room, '--scope', 'command', '--ticket-file', ticketFile, '--log-file', logFile, ...(build === undefined ? [] : ['--build', build])],
      },
    },
  };
}

/** The client's arguments after the command itself. */
export function clientArgs(a: Pick<BotArgs, 'model' | 'client'>, mcpFile: string): string[] {
  return [...a.client.slice(1), '-p', '--model', a.model, '--mcp-config', mcpFile, '--output-format', 'json', '--allowedTools', ALLOWED_TOOLS];
}

export type Failure = 'auth' | 'build' | 'room' | 'mcp';

/**
 * Which known failure a FAILED client run describes, or null. `harness` is the
 * client's stderr and plain stdout, where the harness's own lines land: only
 * its specific refusal lines count (`build_mismatch`; the join's `refused the
 * join: HTTP <status>`; the client naming the `lions` server exiting with code
 * 2). `model` is the client's result text, which can quote anything, so it is
 * read for a sign-in failure alone, never for a refusal.
 */
export function classify(harness: string, model = ''): Failure | null {
  if (/failed to authenticate|oauth (?:session|token) (?:has )?expired|authentication_error|invalid api key|please run \/login|not logged in/i.test(`${harness}\n${model}`)) return 'auth';
  if (/build_mismatch|\blions\b[^\n]*\bexit(?:ed)?(?: with)? code 2\b/i.test(harness)) return 'build';
  // The client's own words when the harness would not start or went away.
  if (/mcp server[^\n]*(?:failed|disconnected|not connected|unavailable)|failed to (?:connect|start)[^\n]*mcp|mcp[^\n]*(?:failed to connect|connection (?:closed|failed))/i.test(harness)) return 'mcp';
  return null;
}

/** The harness's own lines in the bot's log (`<stamp> har <line>`), without the stamps. */
export function harnessLines(logText: string): string[] {
  return logText.split('\n').flatMap((l) => {
    const m = /^\S+ har (.*)$/.exec(l);
    return m === null ? [] : [m[1]];
  });
}

/** The harness's refusal of this client (the build, at the socket's hello) in its own lines, or false. */
export function harnessRefusedBuild(lines: readonly string[]): boolean {
  return lines.some((l) => /^agent: the room refused this client \(build_mismatch\)$/.test(l));
}

/** What to tell the player when the room says no to the join, before any model has started. */
export function joinRefusedMessage(status: number, a: Pick<BotArgs, 'room' | 'server'>): string {
  if (status === 404 || status === 400) return `bot: room ${a.room} was not found on ${a.server} (HTTP ${status}): check the code, or open a new room in the game (Play with a friend -> Open a room).`;
  if (status === 409) return `bot: room ${a.room} already has its second seat (HTTP 409): open a new room in the game (Play with a friend -> Open a room) and run pnpm bot with its code.`;
  if (status === 410) return `bot: room ${a.room} has ended (HTTP 410): open a new room in the game (Play with a friend -> Open a room).`;
  if (status === 429) return 'bot: the server says slow down (HTTP 429): wait a minute and run pnpm bot again.';
  return `bot: the room refused the join (HTTP ${status}): check the code and the server, or open a new room.`;
}

/** What to tell the player about a known failure. */
export function failureMessage(f: Failure, a: Pick<BotArgs, 'server'> & { logFile?: string; roomBuild?: string | null; ourBuild?: string; root?: string }): string {
  switch (f) {
    case 'build': return buildMessage(a);
    case 'room':
      return 'bot: the room is full, closed or not found. Check the code, or open a new room in the game (Play with a friend -> Open a room) and run `pnpm bot` with its code.';
    case 'mcp':
      return `bot: the game connection (harness) stopped: see ${a.logFile ?? 'the bot log'} for why.`;
    case 'auth':
      return [
        'bot: the client could not sign in. Run `claude`, type /login, and run `pnpm bot` again from macOS Terminal',
        '  rather than inside the Claude desktop app: inside the app, the inherited CLAUDE_CODE_* / ANTHROPIC_BASE_URL environment breaks a child CLI.',
      ].join('\n');
  }
}

/** This checkout's root, as the player's shell would say it (`~` for the home directory), quoted if it needs it. */
export const CHECKOUT_ROOT = resolve(dirname(HARNESS_AGENT), '../../..');
function pathForShell(path: string): string {
  const home = homedir();
  const short = path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  return /^[\w@%+=:,./~-]+$/.test(short) ? short : `'${short.replace(/'/g, `'\\''`)}'`;
}

/**
 * Message 1: the room runs another build than this checkout. The room names its
 * own build (in the join's 412, or in the hello's refusal), so the player is
 * told WHICH commit to run from, not to look it up: the game shows only
 * `Build <version>` in its footer, never the commit.
 */
export function buildMessage(a: { server: string; roomBuild?: string | null; ourBuild?: string; root?: string }): string {
  const root = pathForShell(a.root ?? CHECKOUT_ROOT);
  const ours = a.ourBuild === undefined ? '' : `, this checkout is ${shortBuild(a.ourBuild)}`;
  const sha = a.roomBuild === null || a.roomBuild === undefined ? null : /\+([0-9a-f]{7,40})$/.exec(a.roomBuild)?.[1] ?? null;
  if (a.roomBuild !== null && a.roomBuild !== undefined && sha !== null) {
    return [
      `bot: this room runs ${shortBuild(a.roomBuild)}${ours}; a room never plays two builds against each other (the site redeploys on every merge, so a room opened before the latest one keeps its older build).`,
      '  Run pnpm bot from that commit:',
      `    git -C ${root} fetch origin && git -C ${root} checkout --detach ${sha} && pnpm --dir ${root} install`,
      '  Or open a new room in the game now, which runs the current deploy.',
    ].join('\n');
  }
  return [
    `bot: the room (${a.server}) runs a different build than this checkout${ours}, and a room never plays two builds against each other. It did not say which (an older room), and the site redeploys on every merge.`,
    '  Open a new room in the game (Play with a friend -> Open a room) and run pnpm bot from the latest main:',
    `    git -C ${root} fetch origin && git -C ${root} checkout --detach origin/main && pnpm --dir ${root} install`,
  ].join('\n');
}
/** `<version>+<sha7>` of a build string. */
export function shortBuild(b: string): string {
  const m = /^(.*)\+([0-9a-f]{7,40})$/.exec(b);
  return m === null ? b : `${m[1]}+${m[2].slice(0, 7)}`;
}

/** The room's own build, from the harness's lines (`agent: the room runs build <build>`), or null. */
export function harnessRoomBuild(lines: readonly string[]): string | null {
  for (const l of lines) {
    const m = /^agent: the room runs build (\S+)$/.exec(l);
    if (m !== null) return m[1];
  }
  return null;
}

export const ENTRYPOINT_WARNING = 'bot: CLAUDE_CODE_ENTRYPOINT is set, so this shell was started by Claude Code (or its desktop app). The environment it passes on can break a child `claude`; if the bot cannot sign in, run `pnpm bot` from macOS Terminal.';

/**
 * What `pnpm bot` adds to the standing prompt, for a bot seat only (the arena
 * reads `arena-prompt.md` alone). The model's FINAL message is saved as the
 * match report, so it is told exactly what that message is.
 */
export const BOT_ADDENDUM = `
## Your match report (this is a bot seat)

The other player may take a while to press Ready: until the match has started, keep calling \`wait\` (it blocks) and do not give up.

This room has a human in it, so play is REALTIME, not the paced match described above: the match runs while you think. Never call \`end_round\` (it answers "not a paced room"). Your loop is \`observe\`, \`order\`, \`wait\` (20 to 200 ticks, then look again), until \`status\` shows a result. Check \`pace\` in \`status\`; only if it says paced do rounds and \`end_round\` apply.

Your D9 dozer (\`dozer_d9\`) is unarmed and slow: it cannot fight. Its job is to bring down buildings with the \`demolish\` order (and to repair and clear), so send it where there is a structure to take down and keep it behind your troops.

\`observe\` lists wounded men under \`casualties\` (\`mine\`, \`theirs\`), apart from \`units\` and \`contacts\`. They are not orderable units; a medic's \`rescue\` is how they are saved.

An order that the game could not carry out shows as \`dropped\` with a \`reason\` (an \`attack\` on an enemy that left your sight, for instance). Look at \`orders\` and re-issue.

As you play, keep short notes of anything odd: an order refused or dropped for no reason you can see, a tool error, \`observe\` data that looks inconsistent (a unit that vanishes, a count that does not add up, a position off the map), or anything else that seems broken in the game or the tools. For each, note what you did, what you expected and what happened.

When the match is over (\`status\` shows a result, or an acting tool answers \`match over\`), stop playing and make your FINAL message a report in Markdown with exactly these two headings:

## Conclusion
What happened, why you won or lost, and your key decisions.

## Bugs noticed
The oddities from your notes as a list, or the single word "none" if there were none.

Your final message is saved as the match report: write nothing but the report in it.
`;

/** The standing prompt for the bot's seat (seat 1): the arena's, then the report addendum. */
export function botPrompt(a: Pick<BotArgs, 'room'> & { seat?: 0 | 1 }): string {
  return `${standingPrompt({ seat: a.seat ?? 1, code: a.room })}\n${BOT_ADDENDUM}`;
}

/** `YYYYMMDD-HHMMSS-<room>-<model>`: the stem of both files. The model is a flag value, so it is cut to filename-safe characters and can never leave the folder. */
export function fileStem(now: Date, room: string, model: string): string {
  const d = now.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');
  const safe = model.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 80);
  return `${d}-${room}-${safe}`;
}

export interface ReportInput {
  room: string;
  model: string;
  server: string;
  build: string;
  /** How the run ended: `completed`, `failed` or `stopped`. */
  outcome: string;
  tokens: number | null;
  logName: string;
  /** The model's final message, when the client printed one. */
  message: string | null;
  /** Why there is no report, when there is not. */
  why: string | null;
}

/** The report file: a header, then the model's final message, or the reason there is none. */
export function reportMarkdown(r: ReportInput): string {
  const head = [
    '# Bot match report',
    '',
    `- Room: ${r.room}`,
    `- Model: ${r.model}`,
    `- Server: ${r.server}`,
    `- Build: ${r.build}`,
    `- Result: ${r.outcome}`,
    `- Tokens: ${r.tokens === null ? 'unknown' : String(r.tokens)}`,
    `- Log: ${r.logName}`,
    '',
  ];
  if (r.why === null && r.message !== null) return `${[...head, r.message.trimEnd()].join('\n')}\n`;
  const body = [`No report was produced: ${r.why ?? 'the client printed no final message'}.`];
  if (r.message !== null) body.push('', 'The client\'s last message was:', '', ...r.message.trimEnd().split('\n').map((l) => `> ${l}`));
  return `${[...head, ...body].join('\n')}\n`;
}

/** The conventional exit for a process ended by a signal: 128 + its number. */
export type StopSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';
/** SIGHUP is the terminal going away (a closed window): the run ends cleanly with its log and report, as SIGTERM does. */
export const SIGNAL_EXIT: Readonly<Record<StopSignal, number>> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

export interface SignalSource {
  on(signal: StopSignal, handler: () => void): unknown;
  off(signal: StopSignal, handler: () => void): unknown;
}

export interface BotOptions {
  /** Tests inject a fake; default `child_process.spawn`. */
  spawn?: SpawnFn;
  /** Default `process.env`, passed on unchanged. */
  env?: NodeJS.ProcessEnv;
  /** Where SIGINT/SIGTERM/SIGHUP come from; default `process`. */
  signals?: SignalSource;
  /** What a second signal calls; default `process.exit`. */
  exit?: (code: number) => void;
  /** Progress and messages (stderr); default `process.stderr`. */
  log?: (line: string) => void;
  /** The result text (stdout); default `process.stdout`. */
  print?: (line: string) => void;
  /** After SIGTERM, how long before SIGKILL; default 3 s. */
  killMs?: number;
  /** The directory `bot-results/` is made in; default where pnpm was run (`INIT_CWD`), else the cwd. */
  cwd?: string;
  /** The clock for the file names and log stamps. */
  now?: () => Date;
  /** The build string for the report header; default this checkout's `buildId()`. */
  build?: string;
  /** Tests inject the room's answer; default the global `fetch`. */
  fetch?: typeof fetch;
  /** How often the harness's log is checked for a build refusal while the client runs; default 250 ms. */
  pollMs?: number;
  /** Whether a path exists; default `fs.existsSync`. Tests use it for the missing harness. */
  exists?: (path: string) => boolean;
}

/** The folder of logs and reports, under the invoking directory and never outside it. */
export const RESULTS_DIR = 'bot-results';

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

  const now = o.now ?? (() => new Date());
  const fetchFn = o.fetch ?? fetch;
  const exists = o.exists ?? existsSync;
  const pollMs = o.pollMs ?? 250;

  const a = parseBotArgs(argv);
  if ('error' in a) { log(a.error); return 1; }

  // The log and the report: made before anything starts, so a folder that cannot be written is said at once.
  const resultsDir = join(resolve(o.cwd ?? process.env.INIT_CWD ?? process.cwd()), RESULTS_DIR);
  const stem = fileStem(now(), a.room, a.model);
  const logFile = join(resultsDir, `${stem}.log`);
  const reportFile = join(resultsDir, `${stem}-report.md`);
  let build = o.build ?? '';
  if (build === '') { try { build = buildId(); } catch { build = 'unknown'; } }
  try {
    mkdirSync(resultsDir, { recursive: true, mode: 0o700 });
    chmodSync(resultsDir, 0o700); // mkdir ignores the mode when the folder already exists
    writeFileSync(logFile, '', { mode: 0o600, flag: 'a' });
  } catch (e) {
    log(`bot: cannot write ${resultsDir}: ${messageOf(e)}`);
    return 1;
  }
  let logBroken = false;
  /** One timestamped log line per line of `text`. A log that cannot be written loses the log, never the game. */
  const note = (kind: 'bot' | 'out' | 'err', text: string): void => {
    if (logBroken) return;
    try {
      const stamp = now().toISOString();
      appendFileSync(logFile, text.replace(/\n$/, '').split('\n').map((l) => `${stamp} ${kind} ${l}\n`).join(''));
    } catch (e) {
      logBroken = true;
      log(`bot: the log ${logFile} could not be written: ${messageOf(e)}`);
    }
  };
  const say = (line: string): void => { log(line); note('bot', line); };
  note('bot', `room ${a.room}, model ${a.model}, server ${a.server}, build ${build}, client ${a.client[0]}`);
  say(`bot: log: ${logFile}`);
  say(`bot: report: ${reportFile}`);
  const rec: { outcome: string; why: string | null; message: string | null; tokens: number | null } = {
    outcome: 'stopped', why: 'the bot ended before the client finished', message: null, tokens: null,
  };
  const writeReport = (r: { outcome: string; why: string | null; message: string | null; tokens: number | null }): void => {
    try {
      writeFileSync(reportFile, reportMarkdown({
        room: a.room, model: a.model, server: a.server, build, outcome: r.outcome, tokens: r.tokens,
        logName: `${stem}.log`, message: r.message, why: r.why,
      }), { mode: 0o600 });
    } catch (e) {
      log(`bot: the report ${reportFile} could not be written: ${messageOf(e)}`);
    }
  };
  // Written NOW, before anything can go wrong: a bot that is killed outright (SIGKILL, a crash) runs no
  // `finally`, and the lead's first full match left no report at all. The real report replaces this one.
  writeReport({ outcome: 'unfinished', why: 'this run was still going when the file was written, or the bot was killed before it could finish (SIGKILL, a crash); the log has what it saw', message: null, tokens: null });

  if (env.CLAUDE_CODE_ENTRYPOINT !== undefined && env.CLAUDE_CODE_ENTRYPOINT !== '') say(ENTRYPOINT_WARNING);

  const dir = mkdtempSync(join(tempRoot(), 'lions-bot-'));
  let child: ChildProcess | null = null;
  let childGone = false;
  let signalled: StopSignal | null = null;
  let killTimer: NodeJS.Timeout | null = null;
  let watch: NodeJS.Timeout | null = null;
  const removeDir = (): void => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* the finally tries again */ } };
  /** SIGTERM the client, then SIGKILL after `killMs`. */
  const stopChild = (): void => {
    if (child === null || childGone) return;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    const c = child;
    killTimer ??= setTimeout(() => { if (!childGone) { try { c.kill('SIGKILL'); } catch { /* already gone */ } } }, killMs);
    killTimer.unref();
  };
  const onSignal = (signal: StopSignal): void => {
    if (signalled !== null) {
      removeDir();
      say(`bot: second ${signal}: exiting now`);
      exit(SIGNAL_EXIT[signal]);
      return;
    }
    signalled = signal;
    say(`bot: ${signal}: stopping the client and removing ${dir}`);
    rec.why = `stopped by ${signal}`;
    removeDir();
    stopChild();
  };
  const onInt = (): void => { onSignal('SIGINT'); };
  const onTerm = (): void => { onSignal('SIGTERM'); };
  const onHup = (): void => { onSignal('SIGHUP'); };
  signals.on('SIGINT', onInt);
  signals.on('SIGHUP', onHup);
  signals.on('SIGTERM', onTerm);

  try {
    // A signal that landed before the files exist has already removed the directory.
    if (signalled !== null) return SIGNAL_EXIT[signalled];
    chmodSync(dir, 0o700);

    // The harness runner must exist, before a seat is taken: a checkout with no `pnpm install` has none.
    if (!exists(HARNESS_TSX)) {
      say(`bot: the harness runner is missing (${HARNESS_TSX}): run pnpm install in this checkout, then try again.`);
      rec.outcome = 'failed';
      rec.why = 'the harness runner (tsx) is missing: pnpm install has not been run in this checkout';
      return 1;
    }

    // Join HERE, before any model starts: the harness is the client's child, so a refusal inside it
    // would reach us only as "the MCP server failed". A bad code now costs no tokens.
    say(`bot: joining room ${a.room} on ${a.server} as ${a.callsign}`);
    let seat: 0 | 1;
    let ticket: string;
    try {
      ({ seat, ticket } = await joinRoom(a.server, a.room, a.callsign, new URL(a.server).origin, fetchFn, build));
    } catch (e) {
      rec.outcome = 'failed';
      if (e instanceof JoinRefused && e.status === 412) {
        // The room runs another build and said which, before it gave us the seat: no model starts, the seat stays free.
        say(failureMessage('build', { ...a, roomBuild: e.roomBuild, ourBuild: build }));
        rec.why = `the room runs ${e.roomBuild === null ? 'a different build' : shortBuild(e.roomBuild)}, this checkout ${shortBuild(build)}`;
        return 2;
      }
      if (e instanceof JoinRefused) {
        say(joinRefusedMessage(e.status, a));
        rec.why = `the room refused the join (HTTP ${e.status})`;
      } else {
        say(`bot: could not join room ${a.room} on ${a.server}: ${messageOf(e)}`);
        rec.why = `the join failed (${messageOf(e)})`;
      }
      return 1;
    }
    // A signal during the join has already removed the directory.
    if (signalled !== null) return SIGNAL_EXIT[signalled];
    note('bot', `joined as seat ${seat}`);
    const ticketFile = join(dir, 'ticket');
    const mcpFile = join(dir, 'mcp.json');
    const promptFile = join(dir, 'prompt.md');
    // `wx`: a file that is somehow already there is an error, never reused. The ticket lives in this 0600 file only.
    writeFileSync(ticketFile, ticket, { mode: 0o600, flag: 'wx' });
    writeFileSync(mcpFile, `${JSON.stringify(botMcpConfig(a, ticketFile, logFile, build), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    writeFileSync(promptFile, botPrompt({ room: a.room, seat }), { mode: 0o600, flag: 'wx' });

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
      note('out', l);
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
      note('err', chunk);
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
      say(`bot: could not start the client "${command}": ${messageOf(e)}. Install Claude Code, or name the command with --client.`);
      rec.outcome = 'failed';
      rec.why = `the client "${command}" could not start (${messageOf(e)})`;
      return 1;
    }
    // The harness is the client's child: its refusal reaches us only through the log. Watch it, and stop the
    // client at the FIRST build refusal, so no more model tokens are spent on a match that cannot start.
    let refusalSeen = false;
    watch = setInterval(() => {
      if (refusalSeen || childGone) return;
      let mine: string[];
      try { mine = harnessLines(readFileSync(logFile, 'utf8')); } catch { return; }
      if (!harnessRefusedBuild(mine)) return;
      refusalSeen = true;
      say('bot: the room refused the harness\'s build: stopping the client now');
      stopChild();
    }, pollMs);
    say(`bot: ${a.callsign} (${a.model}) holds seat ${seat} of room ${a.room}; Ctrl-C stops it`);
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
    // The harness's own lines, from the log it appended to: the only place its refusal shows.
    let theirs: string[] = [];
    try { theirs = harnessLines(readFileSync(logFile, 'utf8')); } catch { /* no log, no harness lines */ }
    const harnessText = `${out}\n${errOut}\n${theirs.join('\n')}`;
    const all = `${harnessText}\n${parsed?.result ?? ''}`;
    const failed = code !== 0 || signal !== null || parsed?.isError === true;
    rec.tokens = last.result === null ? null : tokensOf(last.result);
    // The harness's own words are not the model's chatter: a refusal there means the match never ran, even if
    // the client then exited cleanly, and a harness that wrote nothing at all never came up.
    if (watch !== null) clearInterval(watch);
    const refusedBuild = harnessRefusedBuild(theirs);
    const harnessMissing = !failed && !logBroken && theirs.length === 0;
    if (failed || refusedBuild || harnessMissing) {
      rec.outcome = 'failed';
      rec.message = parsed?.result ?? null;
      const known: Failure | null = refusedBuild ? 'build' : harnessMissing ? 'mcp' : classify(harnessText, parsed?.result ?? '');
      if (known !== null) {
        const roomBuild = harnessRoomBuild(theirs);
        say(failureMessage(known, { ...a, logFile, roomBuild, ourBuild: build }));
        rec.why = known === 'build' ? `the room refused this checkout's build (the room runs ${roomBuild === null ? 'a different one' : shortBuild(roomBuild)}, this checkout ${shortBuild(build)})` : known === 'room' ? 'the room is full, closed or not found' : known === 'mcp' ? 'the game connection (harness) stopped' : 'the client could not sign in';
        return known === 'build' ? 2 : 1;
      }
      const how = signal !== null ? `was killed by ${signal}` : `exited with code ${String(code)}`;
      rec.why = `the client ${how}`;
      say(`bot: the client ${how}${parsed?.result != null ? `: ${parsed.result}` : ''}`);
      const tail = all.trim().split('\n').slice(-10).join('\n');
      if (tail !== '' && parsed?.result == null) say(tail);
      return 1;
    }
    // A clean exit is not reclassified from the client's chatter (the model can quote anything); only the
    // harness's own log lines, above, can turn it into a failure.
    rec.outcome = 'completed';
    rec.message = parsed?.result ?? null;
    rec.why = rec.message === null || rec.message.trim() === '' ? 'the client exited cleanly but printed no final message' : null;
    print(parsed?.result ?? '(the client printed no result)');
    say(`bot: finished. tokens: ${rec.tokens === null ? 'unknown' : String(rec.tokens)}`);
    return 0;
  } catch (e) {
    rec.outcome = 'failed';
    rec.why = messageOf(e);
    throw e;
  } finally {
    signals.off('SIGINT', onInt);
    signals.off('SIGHUP', onHup);
    signals.off('SIGTERM', onTerm);
    if (watch !== null) clearInterval(watch);
    if (killTimer !== null) clearTimeout(killTimer);
    removeDir();
    // The report is written on every way out: the model's message, or the reason there is none.
    writeReport(rec);
    say(`bot: log: ${logFile}`);
    say(`bot: report: ${reportFile}`);
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
