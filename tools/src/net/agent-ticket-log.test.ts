// GH-954: `agent.ts --log-file <path>` appends every log line to a file that
// outlives the process (and is meant to be pasted into a bug report). A ticket
// is a bearer credential for a seat, so a REAL, valid ticket must never reach
// that file. agent.test.ts only feeds the harness a placeholder string, which
// cannot tell a log that leaks a ticket from one that does not. This runs the
// real harness over stdio against the local relay with a genuine minted ticket:
// join, hello, a tool call, a played round, close; then reads the log back.
// No model, no key.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import { startLocalRelay } from './local-relay';
import { inProcess, passive } from './players';

const here = dirname(fileURLToPath(import.meta.url));
const TSX = join(resolve(here, '../..'), 'node_modules/.bin/tsx');
const AGENT = join(here, 'agent.ts');
const BUILD = 'b-ticketlog';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    try { await c?.(); } catch { /* the next one still runs */ }
  }
});
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Every piece of a ticket worth searching a log for: the whole string, each dot-separated segment, and the decoded payload. */
function ticketPieces(ticket: string): string[] {
  const segments = ticket.split('.');
  const pieces = [ticket, ...segments];
  const payload = segments[0];
  if (payload !== undefined) pieces.push(Buffer.from(payload, 'base64url').toString('utf8'));
  return pieces;
}

describe('a real ticket never reaches the harness --log-file (GH-954)', () => {
  it('ticketPieces yields the whole ticket, each segment and the decoded payload', () => {
    const payload = Buffer.from('{"seat":1}').toString('base64url');
    expect(ticketPieces(`${payload}.sig`)).toEqual([`${payload}.sig`, payload, 'sig', '{"seat":1}']);
  });

  it('join, hello, a tool call, a played round and a close leave a log with the harness in it and the ticket nowhere', async () => {
    const relay = await startLocalRelay({ log: () => {}, tickMs: 5, seedFor: () => 1000 });
    cleanups.push(() => relay.close());
    const post = (path: string, body: unknown): Promise<Response> =>
      fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const created = await post('/api/match', { player: 'bot-a', callsign: 'A', build: BUILD, map: 'tel_marum', mode: 'versus', kind: 'bot', pace: { kind: 'paced', roundTicks: 40, roundWallMs: 2000 } });
    const { code, ticket: ticket0 } = (await created.json()) as { code: string; ticket: string };
    const joined = await post(`/api/match/${code}/join`, { player: 'bot-b', callsign: 'B', kind: 'bot' });
    const { ticket } = (await joined.json()) as { ticket: string };

    // A genuine ticket: two or more segments, a payload that decodes, and long enough that a match means something.
    const pieces = ticketPieces(ticket);
    expect(ticket.split('.').length).toBeGreaterThanOrEqual(2);
    expect(ticket.length).toBeGreaterThan(40);
    for (const p of pieces) expect(p.length).toBeGreaterThanOrEqual(8);

    const dir = mkdtempSync(join(tmpdir(), 'agent-ticketlog-'));
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }); });
    const ticketFile = join(dir, 'ticket');
    const logFile = join(dir, 'bot.log');
    writeFileSync(ticketFile, ticket, { mode: 0o600 });

    const seat0 = await inProcess('p0', passive, { log: () => {} }).start({ server: relay.url, origin: relay.origin, code, seat: 0, ticket: ticket0, build: BUILD });
    cleanups.push(() => seat0.stop());

    const transport = new StdioClientTransport({
      command: TSX,
      args: [AGENT, '--server', relay.url, '--code', code, '--scope', 'command', '--ticket-file', ticketFile, '--log-file', logFile, '--build', BUILD, '--origin', relay.origin],
      env: process.env as Record<string, string>,
      stderr: 'ignore',
    });
    const client = new Client({ name: 'ticketlog-test', version: '0' });
    cleanups.push(() => client.close().catch(() => {}));
    await client.connect(transport);

    const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; body: Record<string, unknown> }> => {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { type: string; text: string }[])[0]?.text ?? '{}';
      return { ok: r.isError !== true, body: JSON.parse(text) as Record<string, unknown> };
    };
    expect((await call('status')).ok).toBe(true);   // a tool call, so the close below is a real leave
    let played = 0;
    for (let i = 0; i < 400 && played < 1; i++) {
      const w = await call('wait', { ticks: 200 });
      if (!w.ok) { if (w.body.error === 'match not started') { await sleep(50); continue; } throw new Error(`wait refused: ${String(w.body.error)}`); }
      if (w.body.reason !== 'round') continue;
      expect((await call('observe')).ok).toBe(true);
      expect((await call('end_round')).ok).toBe(true);
      played++;
    }
    expect(played).toBe(1);
    await client.close();

    // The harness logs the close and exits; wait for its last line so the file is complete.
    let text = '';
    for (let i = 0; i < 100; i++) {
      text = readFileSync(logFile, 'utf8');
      if (/har agent: (the MCP client went away|stdin closed)/.test(text)) break;
      await sleep(50);
    }
    // The log is not empty and is the harness's: a log that were never written would pass the leak check vacuously.
    expect(text).toMatch(/^\S+Z har agent: command on seat 1 of /m);
    expect(text).toMatch(/har agent: (the MCP client went away|stdin closed)/);
    for (const piece of pieces) expect(text, `the log holds ${piece.slice(0, 12)}...`).not.toContain(piece);
  }, 90_000);
});
