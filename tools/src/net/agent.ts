/**
 * `pnpm agent` (N4a task 8, spec §8.1): a headless client of one versus room
 * that a model drives over MCP on stdio.
 *
 *   pnpm agent -- --server https://<your-worker> --code ABC123 --scope command --join
 *   pnpm agent -- --server https://<your-worker> --code ABC123 --scope assist --ticket-file <path>
 *
 * `--join` (command scope) takes the room's second seat as a bot: POST
 * `/api/match/<code>/join` with a fresh player id and `kind: 'bot'`, and plays
 * the seat the room answers. `--ticket-file <path>` plays (or, advise and
 * assist, advises) the seat a ticket names; `-` reads the ticket from the
 * FIRST LINE of stdin, and everything after that line is the MCP stream. A
 * ticket is never accepted on the command line (every process on the
 * machine can read argv), never put in a URL, and never logged.
 *
 * `--log-file <path>` also appends each log line, stamped, to that file (0600
 * on creation): an MCP client started this process and may show none of its
 * stderr, so `pnpm bot` points it at its own log to read why a room was refused.
 *
 * stdout is the MCP protocol channel: every log line goes to stderr.
 * Safe to restart: an MCP client may start this process, close it and start it
 * again (Claude CLI probes a server first). It says `bye` -- which the room reads
 * as a surrender, or a leave in the lobby -- only once the match has started and
 * a tool has been called; closed before that it just drops the socket, and the
 * next start with the same ticket takes the same seat back. Once the match is
 * over it stays up, answering with the final result, until its MCP client goes
 * (stdin closes): a server that exits is started again, and the respawn would
 * replay the match from the room's log as if it were new.
 *
 * Exit codes: 0 on a result or the room ending, 2 when the room refuses the
 * ticket or the build, 3 on a desync (after printing its tick), 1 otherwise.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Readable } from 'node:stream';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AgentClient, matchSocketTarget } from './agent-client';
import { buildId } from './build-id';
import { createContext, SCOPES, toolsFor, type Scope } from './mcp-tools';
import { nodeSocket } from './node-socket';

export interface AgentArgs {
  server: string;
  code: string;
  scope: Scope;
  ticket: { file: string } | { join: true };
  callsign: string;
  /** null: `buildId()`. */
  build: string | null;
  /** null: the server's own origin (decision D9). */
  origin: string | null;
  /** Also append every log line here (see the header); absent: stderr only. */
  logFile?: string;
}

const USAGE = 'usage: pnpm agent -- --server <url> --code <code> --scope advise|assist|command (--ticket-file <path|-> | --join) [--callsign <name>] [--build <id>] [--origin <url>] [--log-file <path>]';
const VALUED = new Set(['server', 'code', 'scope', 'ticket-file', 'callsign', 'build', 'origin', 'log-file']);
const FLAGS = new Set(['join']);

const httpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** The command line, or what is wrong with it. Never echoes a ticket. */
export function parseArgs(argv: readonly string[]): AgentArgs | { error: string } {
  const got = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;   // pnpm passes the separator through
    if (!arg.startsWith('--')) return { error: `unexpected argument "${arg}"\n${USAGE}` };
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    if (name === 'ticket') return { error: 'a ticket on the command line is readable by every process on this machine: use --ticket-file <path>, or --ticket-file - for stdin' };
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
  const server = got.get('server');
  if (server === undefined || !httpUrl(server)) return { error: `--server is the game's http(s) URL\n${USAGE}` };
  const code = got.get('code');
  if (code === undefined) return { error: `--code is required\n${USAGE}` };
  const scope = got.get('scope');
  if (scope === undefined || !(SCOPES as readonly string[]).includes(scope)) return { error: `--scope is advise, assist or command\n${USAGE}` };
  const file = got.get('ticket-file');
  const join = flags.has('join');
  if (join && file !== undefined) return { error: '--join or --ticket-file, not both' };
  if (!join && file === undefined) return { error: `one of --join or --ticket-file is required\n${USAGE}` };
  if (join && scope !== 'command') return { error: '--join is for --scope command: it seats a bot. An advisor joins with the ticket its seat minted (--ticket-file)' };
  const origin = got.get('origin') ?? null;
  if (origin !== null && !httpUrl(origin)) return { error: '--origin is an http(s) URL' };
  return {
    server,
    code,
    scope: scope as Scope,
    ticket: join ? { join: true } : { file: file as string },
    callsign: got.get('callsign') ?? 'Agent',
    build: got.get('build') ?? null,
    origin,
    ...(got.has('log-file') ? { logFile: got.get('log-file') } : {}),
  };
}

/** What a ticket's payload says about its holder. Read, not verified: the
 *  room verifies the signature on hello; this only picks the seat to play
 *  and catches a ticket for the wrong scope before a socket is opened. */
export function ticketClaims(ticket: string): { seat: 0 | 1; role: 'seat' | 'advisor'; scope: 'advise' | 'assist' | null } | null {
  const dot = ticket.indexOf('.');
  if (dot <= 0) return null;
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(ticket.slice(0, dot), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const t = v as Record<string, unknown>;
  if (t.seat !== 0 && t.seat !== 1) return null;
  if (t.role === 'advisor') {
    return t.scope === 'advise' || t.scope === 'assist' ? { seat: t.seat, role: 'advisor', scope: t.scope } : null;
  }
  return t.role === undefined || t.role === 'seat' ? { seat: t.seat, role: 'seat', scope: null } : null;
}

export type AgentEnd =
  | { kind: 'result' }
  | { kind: 'ended' }
  | { kind: 'refused'; code: 'bad_ticket' | 'build_mismatch' }
  | { kind: 'desync'; tick: number }
  | { kind: 'failed' };

export function exitCodeFor(end: AgentEnd): number {
  switch (end.kind) {
    case 'result':
    case 'ended':
      return 0;
    case 'refused':
      return 2;
    case 'desync':
      return 3;
    case 'failed':
      return 1;
  }
}

/** Set from `--log-file` once the command line is read. */
let logFile: string | null = null;
const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
  if (logFile === null) return;
  // A log that cannot be written loses the log, never the match.
  try { appendFileSync(logFile, `${new Date().toISOString()} har ${line}\n`, { mode: 0o600 }); } catch { /* stderr has it */ }
};

/** The first line of `stream`, leaving every byte after it in the stream for the next reader. */
function readFirstLine(stream: Readable): Promise<string> {
  return new Promise((res, rej) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(0x0a);
      if (nl < 0) return;
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.pause();
      const rest = buf.subarray(nl + 1);
      if (rest.length > 0) stream.unshift(rest);
      res(buf.subarray(0, nl).toString('utf8'));
    };
    const onEnd = (): void => {
      stream.off('data', onData);
      if (buf.length > 0) res(buf.toString('utf8'));
      else rej(new Error('stdin closed before a ticket arrived'));
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
  });
}

/** A ticket file's contents. A leading `~/` is the home directory: the lobby
 *  names `~/.roaring-lions/advisor-ticket`, and an MCP client execs this
 *  command with no shell to expand it. */
export function readTicketFile(file: string, home: string = homedir()): string {
  return readFileSync(file.startsWith('~/') ? join(home, file.slice(2)) : file, 'utf8');
}

/** The room said no to a join: `status` is its HTTP status. */
export class JoinRefused extends Error {
  /** `roomBuild`: on a 412, the build the room runs (the join named another). */
  constructor(readonly status: number, readonly roomBuild: string | null = null) {
    super(`the room refused the join: HTTP ${status}`);
    this.name = 'JoinRefused';
  }
}

/**
 * Takes the room's second seat as a bot: POST `/api/match/<code>/join` with a
 * fresh player id and `kind: 'bot'`. Throws `JoinRefused` on any refusal. The
 * ticket is returned to the caller and goes nowhere else. `pnpm bot` calls this
 * too, before it starts a model, so a bad code costs no tokens. With `build`
 * the room compares it BEFORE it reserves the seat and, on a mismatch, answers
 * 412 naming the build it runs (`JoinRefused.roomBuild`): a retry on the right
 * checkout still finds the seat free.
 */
export async function joinRoom(server: string, code: string, callsign: string, origin: string, fetchFn: typeof fetch = fetch, build?: string): Promise<{ seat: 0 | 1; ticket: string }> {
  const base = new URL(server).origin;
  const res = await fetchFn(`${base}/api/match/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ player: randomUUID(), callsign, kind: 'bot', ...(build === undefined ? {} : { build }) }),
  });
  if (res.status === 412) {
    let theirs: string | null = null;
    try {
      const b = (await res.json()) as { build?: unknown };
      if (typeof b.build === 'string' && /^[\x20-\x7e]{1,80}$/.test(b.build)) theirs = b.build;
    } catch { /* an answer with no build */ }
    throw new JoinRefused(412, theirs);
  }
  if (!res.ok) throw new JoinRefused(res.status);
  const body = (await res.json()) as { seat?: unknown; ticket?: unknown };
  if ((body.seat !== 0 && body.seat !== 1) || typeof body.ticket !== 'string') throw new Error('the join answered no seat and ticket');
  return { seat: body.seat, ticket: body.ticket };
}

/** The seat to play and its ticket: the room's answer to a bot join, or the ticket file's. */
async function seatAndTicket(a: AgentArgs, origin: string): Promise<{ seat: 0 | 1; ticket: string }> {
  if ('join' in a.ticket) return joinRoom(a.server, a.code, a.callsign, origin, fetch, a.build ?? buildId());
  const raw = a.ticket.file === '-' ? await readFirstLine(process.stdin) : readTicketFile(a.ticket.file);
  const ticket = raw.trim();
  const claims = ticketClaims(ticket);
  if (claims === null) throw new Error('the ticket file holds no ticket');
  if (a.scope === 'command' && claims.role !== 'seat') throw new Error('--scope command needs a seat ticket; this one is an advisor\'s');
  if (a.scope !== 'command' && (claims.role !== 'advisor' || claims.scope !== a.scope)) {
    throw new Error(`--scope ${a.scope} needs an advisor ticket minted for ${a.scope}; this one is ${claims.role === 'seat' ? 'a seat\'s' : `for ${claims.scope ?? 'nothing'}`}`);
  }
  return { seat: claims.seat, ticket };
}

/** How the match has ended for this client, or null while it runs. `ranNone`: the last pump ran no frame. */
export function endOf(client: AgentClient, ranNone: boolean): AgentEnd | null {
  if (client.failed() !== null) return { kind: 'failed' };
  if (client.result() !== null) return { kind: 'result' };
  const s = client.transport.status();
  if (s.kind === 'desync') return { kind: 'desync', tick: s.tick };
  if (s.kind !== 'closed') return null;
  if (s.reason === 'bad_ticket' || s.reason === 'build_mismatch') return { kind: 'refused', code: s.reason };
  if (s.reason === 'detached' || s.reason === 'replaced') return { kind: 'failed' };
  return ranNone ? { kind: 'ended' } : null;
}

async function main(argv: readonly string[]): Promise<number> {
  const a = parseArgs(argv);
  if ('error' in a) { log(a.error); return 1; }
  logFile = a.logFile ?? null;
  const origin = a.origin ?? new URL(a.server).origin;
  const build = a.build ?? buildId();
  let seat: 0 | 1;
  let ticket: string;
  try {
    ({ seat, ticket } = await seatAndTicket(a, origin));
  } catch (err) {
    log(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const target = matchSocketTarget(a.server, a.code);
  const client = new AgentClient({
    server: a.server, code: a.code, ticket, build, seat, log,
    role: a.scope === 'command' ? 'seat' : 'advisor',
    open: () => nodeSocket(target.url, origin),
  });
  client.ready.then(
    (c) => { log(`agent: ${a.scope} on seat ${seat} of ${c.code} (${c.map}, ${c.pace.kind})`); },
    () => { /* AgentClient has said why on stderr */ },
  );
  const ctx = createContext(client, a.scope);
  const tools = toolsFor(a.scope);

  // Claude CLI starts a stdio server to probe it, closes it, and starts it again, so this process must
  // be safe to start, kill and restart: it says `bye` (a surrender, or a leave in the lobby) only once
  // the match has started AND the model has called a tool. Before that it just lets go of the socket.
  let toolCalled = false;
  let started = false;
  client.ready.then(() => { started = true; }, () => { /* AgentClient has said why on stderr */ });
  const leave = (): void => {
    if (toolCalled && started) client.close();
    else client.release();
  };

  const mcp = new McpServer({ name: 'roaring-lions-agent', version: build });
  // Plain JSON Schema tools: the tool table is the single source, so the
  // server answers list and call itself rather than restating every schema.
  mcp.server.registerCapabilities({ tools: {} });
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema as { type: 'object' } })),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    toolCalled = true;
    const tool = tools.find((t) => t.name === req.params.name);
    const r = tool === undefined
      ? { ok: false, text: JSON.stringify({ error: 'not in this scope' }) }
      : await tool.run(ctx, req.params.arguments ?? {});
    return { content: [{ type: 'text' as const, text: r.text }], isError: !r.ok };
  });

  return new Promise<number>((resolveExit) => {
    let finished = false;
    const finish = (end: AgentEnd): void => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      if (end.kind === 'desync') log(`desync at tick ${end.tick}`);
      else if (end.kind === 'result') log(`agent: ${client.view().result ?? 'decided'}`);
      else if (end.kind === 'refused') {
        log(`agent: the room refused this client (${end.code})`);
        // The room names its own build in a refusal: the line `pnpm bot` reads to tell the player which commit to run.
        const theirs = client.roomBuild();
        if (end.code === 'build_mismatch' && theirs !== null) log(`agent: the room runs build ${theirs}`);
      }
      else log(`agent: ${end.kind}`);
      leave();
      // Let the last messages (an `over`, a `bye`) leave the socket.
      setTimeout(() => { resolveExit(exitCodeFor(end)); }, 250);
    };
    // The match is over: say so ONCE and stay up. An MCP client (Claude CLI) that finds its server gone
    // starts it again, and a respawn into an ended room replays the whole match as if it were new; a
    // server that stays answers with the final result until the client itself goes (GH-973).
    let held = false;
    const timer = setInterval(() => {
      const ran = client.pump(20);
      const end = endOf(client, ran === 0);
      if (end === null) return;
      if (end.kind === 'result' || end.kind === 'ended') {
        if (held) return;
        held = true;
        log(end.kind === 'result' ? `agent: ${client.view().result ?? 'decided'}` : `agent: ${end.kind}`);
        leave();   // over: the socket detaches, no bye
        return;
      }
      finish(end);
    }, 10);
    const transport = new StdioServerTransport();
    transport.onclose = () => { log('agent: the MCP client went away'); finish({ kind: 'ended' }); };
    // `--ticket-file -` paused stdin behind the ticket's line; the transport
    // only listens, so the stream is resumed here. The model closing its end
    // of stdin is the model going away.
    process.stdin.once('end', () => { log('agent: stdin closed'); finish({ kind: 'ended' }); });
    mcp.connect(transport).then(() => { process.stdin.resume(); }, (err: unknown) => {
      log(`agent: MCP failed to start: ${err instanceof Error ? err.message : String(err)}`);
      finish({ kind: 'failed' });
    });
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { finish({ kind: 'ended' }); });
  });
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
const isMain = isEntry();
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => { process.exit(code); },
    (err: unknown) => { log(`agent: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); },
  );
}
