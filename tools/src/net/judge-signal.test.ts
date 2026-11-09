// GH-973: a SIGINT/SIGTERM during an arena run stops a judge exactly as it stops a
// player: the same registry. Alone in its file because `abortExternalPlayers`
// sets the stop latch for good.
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abortExternalPlayers, externalPlayersStopped } from './external-player';
import { runJudge } from './judge';
import { RefereeTally } from './match-score';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import { versusConfig } from './test-config';

let root = '';
const saved = process.env.LIONS_ARENA_TMPDIR;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'judge-signal-')); process.env.LIONS_ARENA_TMPDIR = root; });
afterEach(() => {
  if (saved === undefined) delete process.env.LIONS_ARENA_TMPDIR; else process.env.LIONS_ARENA_TMPDIR = saved;
  rmSync(root, { recursive: true, force: true });
});

class Hung extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kills: string[] = [];
  gone = false;
  kill(sig?: string): boolean {
    this.kills.push(String(sig));
    if (!this.gone) { this.gone = true; this.emit('exit', null, sig); this.stdout.end(); this.stderr.end(); this.emit('close', null, sig); }
    return true;
  }
}

describe('a signal during a judge', () => {
  it('stops the judge, removes its directory, and lets no further judge start', async () => {
    const child = new Hung();
    let dir = '';
    const stats = new RefereeTally().stats(buildMatchWorld(versusConfig('tel_marum')).sim, { map: 'tel_marum', sides: [0, 1], factions: ['kdf', 'kdf'], result: null });
    const running = runJudge({
      template: 'cmd:judge-cli < {prompt}', stats, players: ['a', 'b'], outcome: 'x', timeoutMs: 60_000, killMs: 20,
      spawn: (_c, _a, o) => { dir = o.cwd as string; queueMicrotask(() => { child.emit('spawn'); }); return child as unknown as ChildProcess; },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(existsSync(dir)).toBe(true);
    await abortExternalPlayers(50);
    expect(child.kills[0]).toBe('SIGTERM');
    expect(existsSync(dir)).toBe(false);
    const r = await running;
    expect(r.status).toBe('failed');
    expect(readdirSync(root)).toEqual([]);
    // From now on a judge is refused before it has a directory.
    expect(externalPlayersStopped()).toBe(true);
    const again = await runJudge({ template: 'cmd:judge-cli', stats, players: ['a', 'b'], outcome: 'x', timeoutMs: 1000, spawn: () => { throw new Error('must not start'); } });
    expect(again).toMatchObject({ status: 'failed' });
    expect(readdirSync(root)).toEqual([]);
  });
});
