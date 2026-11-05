// GH-954: Claude CLI starts an MCP server to probe it, closes it, and starts it
// again, so the harness (`agent.ts`) must be safe to start, kill and restart on
// the SAME ticket. A close before the first tool call must not say `bye` (a
// surrender, or a leave in the lobby); the next start must take the same seat
// back and play. Real harness processes over stdio, against the local relay on
// 127.0.0.1; the "model" is this file driving the tools. No model, no key.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import { startLocalRelay, type LocalRelay } from './local-relay';
import { inProcess, passive, type RunningPlayer } from './players';

const here = dirname(fileURLToPath(import.meta.url));
const TSX = join(resolve(here, '../..'), 'node_modules/.bin/tsx');
const AGENT = join(here, 'agent.ts');
const BUILD = 'b-restart';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    try { await c?.(); } catch { /* the next one still runs */ }
  }
});
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function room(relay: LocalRelay): Promise<{ code: string; tickets: [string, string] }> {
  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const created = await post('/api/match', { player: 'bot-a', callsign: 'A', build: BUILD, map: 'tel_marum', mode: 'versus', kind: 'bot', pace: { kind: 'paced', roundTicks: 40, roundWallMs: 2000 } });
  const { code, ticket } = (await created.json()) as { code: string; ticket: string };
  const joined = await post(`/api/match/${code}/join`, { player: 'bot-b', callsign: 'B', kind: 'bot' });
  const j = (await joined.json()) as { ticket: string };
  return { code, tickets: [ticket, j.ticket] };
}

/** The harness on `ticket` as an MCP client sees it: stdio, started by the client, closed by it. */
function mcpClient(relay: LocalRelay, code: string, ticketFile: string): { client: Client; transport: StdioClientTransport } {
  const transport = new StdioClientTransport({
    command: TSX,
    args: [AGENT, '--server', relay.url, '--code', code, '--scope', 'command', '--ticket-file', ticketFile, '--build', BUILD, '--origin', relay.origin],
    env: process.env as Record<string, string>,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'restart-test', version: '0' });
  cleanups.push(() => client.close().catch(() => {}));
  return { client, transport };
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0]?.text ?? '{}';
  return { ok: r.isError !== true, body: JSON.parse(text) as Record<string, unknown> };
}
/** Plays rounds: waits for the room to wait on this seat, looks, ends the round. Returns how many it played. */
async function playRounds(client: Client, n: number): Promise<number> {
  let played = 0;
  for (let i = 0; i < 400 && played < n; i++) {
    const w = await call(client, 'wait', { ticks: 200 });
    if (!w.ok) { if (w.body.error === 'match not started') { await sleep(50); continue; } throw new Error(`wait refused: ${String(w.body.error)}`); }
    if (w.body.reason === 'result' || w.body.reason === 'ended') throw new Error(`the match ended after ${played} round(s): ${String(w.body.reason)}`);
    if (w.body.reason !== 'round') continue;
    const o = await call(client, 'observe');
    expect(o.ok).toBe(true);
    expect((o.body.units as unknown[]).length).toBeGreaterThan(0);
    expect((await call(client, 'end_round')).ok).toBe(true);
    played++;
  }
  return played;
}

describe('the harness survives an MCP probe: close, restart on the same ticket, play', () => {
  async function setup(): Promise<{ relay: LocalRelay; code: string; tickets: [string, string]; ticketFile: string }> {
    const relay = await startLocalRelay({ log: () => {}, tickMs: 5, seedFor: () => 1000 });
    cleanups.push(() => relay.close());
    const r = await room(relay);
    const dir = mkdtempSync(join(tmpdir(), 'agent-restart-'));
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }); });
    const ticketFile = join(dir, 'ticket');
    writeFileSync(ticketFile, r.tickets[1], { mode: 0o600 });
    return { relay, ...r, ticketFile };
  }
  const seat0 = async (relay: LocalRelay, code: string, ticket: string): Promise<RunningPlayer> => {
    const p = await inProcess('p0', passive, { log: () => {} }).start({ server: relay.url, origin: relay.origin, code, seat: 0, ticket, build: BUILD });
    cleanups.push(() => p.stop());
    return p;
  };

  it('a probe that closes in the lobby, before any tool call, leaves the seat: the restart plays', async () => {
    const { relay, code, tickets, ticketFile } = await setup();
    // Probe: initialise, list the tools, say nothing else, close. The seat's socket is in the lobby.
    const probe = mcpClient(relay, code, ticketFile);
    await probe.client.connect(probe.transport);
    expect((await probe.client.listTools()).tools.length).toBeGreaterThan(0);
    await sleep(500);   // the harness has opened its socket and readied
    await probe.client.close();
    await sleep(300);
    // The restart presents the same ticket; the other seat arrives now, so the match can start.
    const p0 = await seat0(relay, code, tickets[0]);
    const again = mcpClient(relay, code, ticketFile);
    await again.client.connect(again.transport);
    expect(await playRounds(again.client, 2)).toBe(2);
    // A tool HAS been called now: closing is the seat leaving, and the room says so to the other seat.
    await again.client.close();
    const done = await Promise.race([p0.done.then(() => 'ended'), sleep(15_000).then(() => 'still running')]);
    expect(done).toBe('ended');
  }, 90_000);

  it('a client that called a tool in the lobby and then closed before the match started has not left either', async () => {
    const { relay, code, tickets, ticketFile } = await setup();
    const first = mcpClient(relay, code, ticketFile);
    await first.client.connect(first.transport);
    await call(first.client, 'status');   // a tool call, but the match has not started
    await sleep(500);
    await first.client.close();
    await sleep(300);
    const p0 = await seat0(relay, code, tickets[0]);
    const early = await Promise.race([p0.done.then(() => 'ended'), sleep(1500).then(() => 'still running')]);
    expect(early).toBe('still running');   // a lobby `bye` would have ended the room for seat 0
    const again = mcpClient(relay, code, ticketFile);
    await again.client.connect(again.transport);
    expect(await playRounds(again.client, 2)).toBe(2);
    await again.client.close();
  }, 90_000);

  it('a probe that closes after the match has started, before any tool call, does not surrender', async () => {
    const { relay, code, tickets, ticketFile } = await setup();
    const p0 = await seat0(relay, code, tickets[0]);
    const probe = mcpClient(relay, code, ticketFile);
    await probe.client.connect(probe.transport);
    await probe.client.listTools();
    await sleep(800);   // both seats are in: the match has started
    await probe.client.close();
    const early = await Promise.race([p0.done.then(() => 'ended'), sleep(1500).then(() => 'still running')]);
    expect(early).toBe('still running');   // a `bye` would have ended it for seat 0
    const again = mcpClient(relay, code, ticketFile);
    await again.client.connect(again.transport);
    expect(await playRounds(again.client, 2)).toBe(2);
    await again.client.close();
  }, 90_000);
});

describe('a build refusal names the room\'s build (GH-954), through the real room', () => {
  it('the join refuses a mismatching build with 412 and the room\'s own, without taking the seat', async () => {
    const relay = await startLocalRelay({ log: () => {}, tickMs: 5, seedFor: () => 1000 });
    cleanups.push(() => relay.close());
    const created = await fetch(`${relay.url}/api/match`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify({ player: 'bot-a', callsign: 'A', build: BUILD, map: 'tel_marum', mode: 'versus', kind: 'bot' }) });
    const { code } = (await created.json()) as { code: string };
    const join = (build: string): Promise<Response> => fetch(`${relay.url}/api/match/${code}/join`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify({ player: 'bot-b', callsign: 'B', kind: 'bot', build }) });
    const bad = await join('0.0.0+deadbeef');
    expect(bad.status).toBe(412);
    expect(await bad.json()).toEqual({ error: 'build_mismatch', build: BUILD });
    expect((await join(BUILD)).status).toBe(200);   // the refusal took no seat
  });
  it('the harness\'s hello refusal writes the room\'s build to its --log-file', async () => {
    const relay = await startLocalRelay({ log: () => {}, tickMs: 5, seedFor: () => 1000 });
    cleanups.push(() => relay.close());
    const { code, tickets } = await room(relay);
    const dir = mkdtempSync(join(tmpdir(), 'agent-refused-'));
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }); });
    const ticketFile = join(dir, 'ticket');
    writeFileSync(ticketFile, tickets[1], { mode: 0o600 });
    const logFile = join(dir, 'bot.log');
    const child = spawn(TSX, [AGENT, '--server', relay.url, '--code', code, '--scope', 'command', '--ticket-file', ticketFile, '--build', '0.0.0+deadbeef', '--origin', relay.origin, '--log-file', logFile], { stdio: ['pipe', 'ignore', 'ignore'] });
    cleanups.push(() => { child.kill('SIGKILL'); });
    const status = await new Promise<number | null>((res) => { child.on('exit', (c) => { res(c); }); });
    expect(status).toBe(2);
    const text = readFileSync(logFile, 'utf8');
    expect(text).toMatch(/ har agent: the room refused this client \(build_mismatch\)$/m);
    expect(text).toMatch(new RegExp(` har agent: the room runs build ${BUILD}$`, 'm'));
  }, 30_000);
});

describe('the harness stays up after the match, and a respawn into the ended room reports the result (GH-973)', () => {
  async function endedMatch(): Promise<{ relay: LocalRelay; code: string; ticketFile: string; first: ReturnType<typeof mcpClient>; p0: RunningPlayer }> {
    const relay = await startLocalRelay({ log: () => {}, tickMs: 5, seedFor: () => 1000 });
    cleanups.push(() => relay.close());
    const { code, tickets } = await room(relay);
    const dir = mkdtempSync(join(tmpdir(), 'agent-over-'));
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }); });
    const ticketFile = join(dir, 'ticket');
    writeFileSync(ticketFile, tickets[1], { mode: 0o600 });
    const p0 = await inProcess('p0', passive, { log: () => {} }).start({ server: relay.url, origin: relay.origin, code, seat: 0, ticket: tickets[0], build: BUILD });
    cleanups.push(() => p0.stop());
    const first = mcpClient(relay, code, ticketFile);
    await first.client.connect(first.transport);
    expect(await playRounds(first.client, 2)).toBe(2);
    p0.client?.transport.surrender();   // seat 0 gives up: the match is over, seat 1 has won
    return { relay, code, ticketFile, first, p0 };
  }
  const resultOf = async (client: Client): Promise<unknown> => {
    for (let i = 0; i < 100; i++) {
      const st = await call(client, 'status');
      if (st.body.result !== null && st.body.result !== undefined) return st.body.result;
      await sleep(50);
    }
    return null;
  };

  it('answers with the final result for as long as its client stays, and says match over to an order', async () => {
    const { first } = await endedMatch();
    expect(await resultOf(first.client)).not.toBeNull();
    await sleep(1000);   // a harness that exited on the result would be gone by now, and Claude CLI would have started another
    const again = await call(first.client, 'status');
    expect(again.ok).toBe(true);
    expect(again.body.result).not.toBeNull();
    const w = await call(first.client, 'wait', { ticks: 20 });
    expect(w.ok).toBe(true);
    expect(w.body.reason).toMatch(/^(result|ended)$/);
    const o = await call(first.client, 'order', { verb: 'halt', ids: [1] });
    expect(o.ok).toBe(false);
    expect(o.body.error).toBe('match over');
  }, 90_000);

  it('a respawn into the ended room replays to the end and reports the result: wait reaches it, order is match over, never "not started"', async () => {
    const { relay, code, ticketFile, first } = await endedMatch();
    const finalTick = (await call(first.client, 'status')).body.tick as number;
    expect(await resultOf(first.client)).not.toBeNull();
    await first.client.close();
    await sleep(300);
    const second = mcpClient(relay, code, ticketFile);
    await second.client.connect(second.transport);
    // The model's first calls, as the lead's log saw them: wait, then order, then status.
    const w = await call(second.client, 'wait', { ticks: 20 });
    expect(w.body.reason).toMatch(/^(result|ended)$/);
    expect(w.body.tick).toBeGreaterThanOrEqual(finalTick - 40);   // the replay ran on to the end, not 20 ticks into it
    const o = await call(second.client, 'order', { verb: 'halt', ids: [1] });
    expect(o.body.error).toBe('match over');
    // Poll, not a single read: under load the replay can still be finishing.
    expect(await resultOf(second.client)).not.toBeNull();
    await second.client.close();
  }, 90_000);
});
