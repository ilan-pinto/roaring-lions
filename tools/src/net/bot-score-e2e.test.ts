// GH-973: the bot's scoring path over a REAL stdio MCP session. The stand-in client
// (`test-mcp-client.ts --score-file`, no model, no key) plays rush through the real
// harness on the real local relay, asks for `match_stats` mid-match (refused: the
// numbers cover both sides), and when the match is over reads them and submits a
// canned score of both players. What it leaves is the file `pnpm bot` reads.
//
// The match ends by the other seat leaving (the room reads a `bye` as a surrender):
// a game that stops at the arena's cap is never "over" for an external client.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { externalPlayer } from './external-player';
import { startLocalRelay } from './local-relay';
import { readScoreFile } from './match-score';
import { inProcess, passive } from './players';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const TSX = join(root, 'tools/node_modules/.bin/tsx');
const CLIENT = join(here, 'test-mcp-client.ts');
const BUILD = 'b-score-e2e';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    try { await cleanups.pop()?.(); } catch { /* the next one still runs */ }
  }
});
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => { rmSync(d, { recursive: true, force: true }); });
  return d;
}

describe('the harness with --score-file, end to end', () => {
  it('refuses match_stats while the match runs, then gives both seats\' numbers and saves the accepted score', async () => {
    const relay = await startLocalRelay({ log: () => {}, tickMs: 5, seedFor: () => 1000 });
    cleanups.push(() => relay.close());
    const post = (path: string, body: unknown): Promise<Response> =>
      fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const created = await post('/api/match', { player: 'bot-a', callsign: 'A', build: BUILD, map: 'tel_marum', mode: 'versus', kind: 'bot', pace: { kind: 'paced', roundTicks: 40, roundWallMs: 5000 } });
    const { code, ticket } = (await created.json()) as { code: string; ticket: string };
    const joined = await post(`/api/match/${code}/join`, { player: 'bot-b', callsign: 'B', kind: 'bot' });
    const theirs = ((await joined.json()) as { ticket: string }).ticket;

    const out = tempDir('score-e2e-');
    const file = join(tempDir('score-file-'), 'scores.json');
    const fake = `cmd:${TSX} ${CLIENT} {mcp} --score-file ${file}`;
    const logFile = join(out, 'client.log');
    const ext = await externalPlayer(fake, fake, { graceMs: 30_000 }).start({ server: relay.url, origin: relay.origin, code, seat: 0, ticket, build: BUILD, logFile });
    cleanups.push(() => ext.stop());
    const other = await inProcess('passive', passive, { log: () => {} }).start({ server: relay.url, origin: relay.origin, code, seat: 1, ticket: theirs, build: BUILD });
    cleanups.push(() => other.stop());

    // Let a few rounds run, then the passive seat leaves: the room calls it a surrender, and the match is over for the client.
    const deadline = Date.now() + 120_000;
    while ((other.client?.tick() ?? 0) < 200 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(other.client?.tick() ?? 0).toBeGreaterThanOrEqual(200);
    await other.stop();
    const report = await ext.done;
    expect(report.errors).toEqual([]);

    const text = readFileSync(logFile, 'utf8');
    expect(text).toContain('early match_stats: match not over');
    expect(text).not.toContain('early match_stats ANSWERED');
    expect(text).toMatch(/; scored/);

    const raw = JSON.parse(readFileSync(file, 'utf8')) as { seat: number; referee: { tick: number; seats: { ordersSent: number; deaths: number }[]; result: string | null }; scores: { seat0: { criteria: { fewer_deaths: { reason: string } } } } };
    expect(raw.seat).toBe(0);
    expect(raw.referee.result).toMatch(/^seat 0 won \((surrender|left)\)/);
    expect(raw.referee.tick).toBeGreaterThanOrEqual(200);
    expect(raw.referee.seats[0].ordersSent).toBeGreaterThan(0);
    expect(raw.referee.seats[1].ordersSent).toBe(0);
    // The reasons cite the numbers the client READ through the tool: they are the file's own.
    expect(raw.scores.seat0.criteria.fewer_deaths.reason).toBe(`fewer_deaths: ${raw.referee.seats[0].deaths} deaths, ${raw.referee.seats[0].ordersSent} orders`);
    expect(readScoreFile(file).status).toBe('scored');
  }, 180_000);
});
