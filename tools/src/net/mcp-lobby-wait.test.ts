// GH-954: `wait` in a lobby BLOCKS until the match starts (the other player may
// take a while to press Ready), bounded, instead of answering `match not
// started` at once and sending a model away. A stand-in client keeps these
// cases to the lobby logic; the real room is covered by agent-restart.test.ts.
import { describe, expect, it } from 'vitest';
import type { AgentClient } from './agent-client';
import { createContext, LOBBY_WAIT_MAX_MS, TOOLS, type Scope, type ToolContext } from './mcp-tools';

interface Stub { client: AgentClient; start(): void; close(): void; calls: number }
/** Just enough of an AgentClient for `wait`: not started until `start()`, then a result. */
function stub(): Stub {
  let config: object | null = null;
  let closed = false;
  const s = {
    calls: 0,
    start(): void { config = { pace: null }; },
    close(): void { closed = true; },
  };
  const client = {
    config: () => { s.calls++; return config; },
    tick: () => 0,
    result: () => (config === null ? null : { winner: 0 }),
    view: () => ({ result: 'seat 0 won' }),
    transport: { status: () => (closed ? { kind: 'closed', reason: 'ended' } : { kind: 'open' }), behind: () => 0, onHooks: () => {}, setHooks: () => {} },
    seat: 1,
    joinedUnderway: () => false,
  } as unknown as AgentClient;
  return Object.assign(s, { client });
}
const wait = TOOLS.find((t) => t.name === 'wait');
const run = (ctx: ToolContext): ReturnType<NonNullable<typeof wait>['run']> => {
  if (wait === undefined) throw new Error('no wait tool');
  return wait.run(ctx, { ticks: 1 });
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ctxOf = (s: Stub, scope: Scope = 'command', lobbyWaitMs?: number): ToolContext => {
  const ctx = createContext(s.client, scope);
  if (lobbyWaitMs !== undefined) ctx.lobbyWaitMs = lobbyWaitMs;
  return ctx;
};

describe('wait in a lobby', () => {
  it('blocks, not answering, until the match starts, then runs on', async () => {
    const s = stub();
    let settled = false;
    const p = run(ctxOf(s, 'command', 5000)).then((r) => { settled = true; return r; });
    await sleep(150);
    expect(settled).toBe(false);          // 150 ms in the lobby and still waiting for Ready
    s.start();
    const r = await p;
    expect(r.ok).toBe(true);
    expect((JSON.parse(r.text) as { reason: string }).reason).toBe('result');
  });
  it('gives up after its bound with the reason, as a refusal named match not started', async () => {
    const s = stub();
    const t0 = Date.now();
    const r = await run(ctxOf(s, 'command', 80));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    expect(r.ok).toBe(false);
    expect(JSON.parse(r.text)).toEqual({ error: 'match not started', detail: 'still waiting for the other player to press Ready' });
  });
  it('the bound is ten minutes by default', () => {
    expect(LOBBY_WAIT_MAX_MS).toBe(600_000);
  });
  it('a room that closes in the lobby is match over, at once', async () => {
    const s = stub();
    s.close();
    const t0 = Date.now();
    const r = await run(ctxOf(s));
    expect(Date.now() - t0).toBeLessThan(500);
    expect(JSON.parse(r.text)).toMatchObject({ error: 'match over' });
  });
  it('blocks for the advisor scopes too', async () => {
    for (const scope of ['advise', 'assist'] as const) {
      const s = stub();
      const r = await run(ctxOf(s, scope, 60));
      expect(JSON.parse(r.text)).toMatchObject({ error: 'match not started', detail: 'still waiting for the other player to press Ready' });
    }
  });
  it('a bad ticks argument is refused before it blocks', async () => {
    const s = stub();
    const ctx = ctxOf(s, 'command', 5000);
    const t0 = Date.now();
    const r = await wait?.run(ctx, { ticks: 0 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(JSON.parse(r?.text ?? '{}')).toMatchObject({ error: 'invalid' });
  });
});
