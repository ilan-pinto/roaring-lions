/**
 * A stand-in for a model (N4b task 14): an MCP client that plays `rush`
 * through the harness's tools and nothing else. It needs no model and no key,
 * so `externalPlayer` can be tested end to end -- arena, temp directory, MCP
 * config, spawned `pnpm agent`, room -- with nothing billed.
 *
 *   tsx tools/src/net/test-mcp-client.ts <mcp config path>
 *
 * It reads the MCP config the arena wrote, spawns the server it names (the
 * harness) over stdio, and loops: `wait` until the room waits on this seat's
 * `end_round` (or the match is over), `observe`, the SHIPPED `rush` policy on
 * what `observe` answered, one `order` per command, `end_round`. It has no
 * access to the sim: what it decides on is the JSON `observe` returns, which
 * is the seat's fog-honest view and nothing more.
 *
 * One difference from the in-process `rush`, and it is the MCP surface's, not
 * this file's: `order` takes a verb, ids and a tile, so rush's `sweep: true`
 * does not cross (a model cannot ask for a cursor sweep either).
 *
 * stdout carries exactly one line, at the end -- on a SIGTERM from the arena
 * too: what a real client prints, a JSON object with `usage` (this one spends
 * no tokens, so both are 0). Every log line goes to stderr.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Command } from '@lions/sim';
import { rush } from './players';
import type { SideView } from './view';

const log = (line: string): void => { process.stderr.write(`test-mcp-client: ${line}\n`); };

interface ServerEntry { command: string; args: string[] }

/** The `lions` server an MCP config names. */
export function serverOf(configText: string): ServerEntry {
  const v = JSON.parse(configText) as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> };
  const s = v.mcpServers?.lions;
  if (s === undefined || typeof s.command !== 'string' || !Array.isArray(s.args) || !s.args.every((a) => typeof a === 'string')) {
    throw new Error('the MCP config names no "lions" server');
  }
  return { command: s.command, args: s.args as string[] };
}

/** An `order` call's arguments for a command rush built: tiles, as the tool takes them. */
export function orderArgs(cmd: Command): Record<string, unknown> {
  const c = cmd as Record<string, unknown>;
  const out: Record<string, unknown> = { verb: cmd.kind, ids: c.ids };
  // rush aims at a tile's centre (`fx.from(t + 0.5)`): the integer part is the tile.
  if (typeof c.x === 'number' && typeof c.y === 'number') { out.x = c.x >> 16; out.y = c.y >> 16; }
  return out;
}

/** The one stdout line, then the exit: on a pipe, stdout may be asynchronous, so exit waits for the write. */
function finalLine(outcome: string, code: number): void {
  process.stdout.write(`${JSON.stringify({ type: 'result', result: outcome, usage: { input_tokens: 0, output_tokens: 0 } })}\n`, () => { process.exit(code); });
}

const sleep = (ms: number): Promise<void> => new Promise((res) => { setTimeout(res, ms); });

/** A tool's JSON answer, and whether the tool refused. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0]?.text ?? '{}';
  return { ok: r.isError !== true, body: JSON.parse(text) as Record<string, unknown> };
}

async function play(client: Client): Promise<string> {
  let orders = 0;
  for (;;) {
    const w = await call(client, 'wait', { ticks: 200 });
    if (!w.ok) {
      if (w.body.error === 'match not started') { await sleep(50); continue; }
      return `wait refused: ${String(w.body.error)}`;
    }
    const reason = w.body.reason;
    if (reason === 'result' || reason === 'ended') return `${String(reason)} after ${orders} order(s)`;
    if (reason !== 'round') continue;
    const o = await call(client, 'observe');
    if (!o.ok) return `observe refused: ${String(o.body.error)}`;
    for (const cmd of await rush(o.body as unknown as SideView)) {
      const r = await call(client, 'order', orderArgs(cmd));
      if (r.ok) orders++;
      else log(`order refused: ${String(r.body.error)}`);
    }
    const e = await call(client, 'end_round');
    if (!e.ok && e.body.error === 'match over') return `match over after ${orders} order(s)`;
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const path = argv[0];
  if (path === undefined) { log('usage: tsx tools/src/net/test-mcp-client.ts <mcp config>'); process.exit(1); }
  const server = serverOf(readFileSync(path, 'utf8'));
  const transport = new StdioClientTransport({ command: server.command, args: server.args, env: process.env as Record<string, string>, stderr: 'inherit' });
  const client = new Client({ name: 'lions-test-mcp-client', version: '0' });
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => { closing ??= client.close().catch(() => {}); return closing; };
  // Stopped by the arena: the harness is this process's child, closed by its own handle.
  process.once('SIGTERM', () => { void close().then(() => { log('stopped (SIGTERM)'); finalLine('stopped', 143); }); });
  await client.connect(transport);
  log(`harness pid ${String(transport.pid)}`);
  let outcome: string;
  try {
    outcome = await play(client);
  } catch (e) {
    outcome = `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  log(outcome);
  await close();
  finalLine(outcome, outcome.startsWith('failed') ? 1 : 0);
}

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
  main(process.argv.slice(2)).then(
    () => { /* `finalLine` exits */ },
    (err: unknown) => { log(err instanceof Error ? err.message : String(err)); process.exit(1); },
  );
}
