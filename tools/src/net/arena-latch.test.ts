// N4b minors review (I-2): once a signal's cleanup has begun
// (`abortExternalPlayers`), no new external seat and no new game may start --
// a seat spawned while the cleanup awaits would escape it and outlive
// `process.exit`. The latch is module state, so this file is its own module
// instance (vitest isolates files) and nothing else here may start a seat.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runArena } from './arena';
import { abortExternalPlayers, externalPlayer, type SpawnFn } from './external-player';
import type { RunningPlayer } from './players';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    try { await c?.(); } catch { /* the next one still runs */ }
  }
});

describe('the stop latch', () => {
  it('after abortExternalPlayers, a seat is refused before its temp directory exists, and nothing is spawned', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arena-latch-test-'));
    cleanups.push(() => { rmSync(root, { recursive: true, force: true }); });
    const before = process.env.LIONS_ARENA_TMPDIR;
    process.env.LIONS_ARENA_TMPDIR = root;
    cleanups.push(() => { if (before === undefined) delete process.env.LIONS_ARENA_TMPDIR; else process.env.LIONS_ARENA_TMPDIR = before; });
    let spawned = 0;
    // A real child, by its own handle, should the latch fail and let one through.
    const counting: SpawnFn = (command, args, options) => { spawned++; return spawn(command, args, options); };
    const player = externalPlayer('x', `cmd:${process.execPath} -e "setTimeout(() => {}, 5000)"`, { spawn: counting, graceMs: 0, killMs: 500 });

    await abortExternalPlayers();
    let started: RunningPlayer | null = null;
    const attempt = player.start({ server: 'http://127.0.0.1:1', origin: 'http://127.0.0.1:1', code: 'ABCDEF', seat: 0, ticket: 'not-a-ticket', build: 'b' })
      .then((r) => { started = r; cleanups.push(() => r.stop()); });
    await expect(attempt).rejects.toThrow(/stopping/);
    expect(started).toBeNull();
    expect(spawned).toBe(0);
    expect(readdirSync(root)).toEqual([]);
  });

  it('after abortExternalPlayers, runArena starts no further game: no relay is asked for', async () => {
    await abortExternalPlayers();
    const out = mkdtempSync(join(tmpdir(), 'arena-latch-out-'));
    cleanups.push(() => { rmSync(out, { recursive: true, force: true }); });
    let relays = 0;
    const r = await runArena(['--a', 'passive', '--b', 'rush', '--seeds', '1', '--out', out], {
      log: () => {}, print: () => {},
      startRelay: async () => { relays++; throw new Error('this spec starts no relay'); },
    });
    expect(relays).toBe(0);
    expect(r.code).toBe(1);
    expect(r.games).toEqual([]);
  });
});
