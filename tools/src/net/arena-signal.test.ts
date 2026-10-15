// N4b minors: a signal to `pnpm arena` cleans up after itself. The arena runs
// as a real child process (`tsx arena.ts`) with one external `cmd:` player
// that only sleeps, so the game never starts and the seat's temp directory --
// a 0700 directory holding the 0600 ticket -- stands until the signal. Its
// temp root is this test's own (`LIONS_ARENA_TMPDIR`), so the check reads one
// directory and never `os.tmpdir()` at large. The arena is signalled and
// waited for by its own handle, in a process group of its own (`detached`),
// so a failed test kills that group -- the arena, tsx's child and the
// sleeper -- and nothing else; the sleeper is checked by the pid it wrote.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const TSX = join(root, 'tools/node_modules/.bin/tsx');
const ARENA = join(here, 'arena.ts');

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    try { await c?.(); } catch { /* the next one still runs */ }
  }
});
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`${what}: not within ${ms} ms`);
    await sleep(25);
  }
}

/** The arena on one sleeping external player, its temp root, and the sleeper's pid file. */
function startArena(o: { stubborn?: boolean } = {}): { arena: ChildProcess; tmpRoot: string; pidFile: string; stderr: string[]; exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> } {
  const base = mkdtempSync(join(tmpdir(), 'arena-signal-test-'));
  cleanups.push(() => { rmSync(base, { recursive: true, force: true }); });
  const tmpRoot = join(base, 'tmp');
  mkdirSync(tmpRoot);
  const out = join(base, 'out');
  const pidFile = join(base, 'sleeper.pid');
  const sleeper = join(base, 'sleeper.mjs');
  // Writes its pid, then never ends by itself: it never connects, so the room never starts.
  // A stubborn one ignores SIGTERM, so the arena's cleanup waits out its SIGKILL escalation.
  const ignoreTerm = o.stubborn === true ? `process.on('SIGTERM', () => {});\n` : '';
  writeFileSync(sleeper, `import { writeFileSync } from 'node:fs';\n${ignoreTerm}writeFileSync(process.argv[2], String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  cleanups.push(() => {
    // Only if the arena failed to stop it: by the pid it wrote, never by name.
    if (!existsSync(pidFile)) return;
    const pid = Number(readFileSync(pidFile, 'utf8'));
    if (pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL');
  });
  const arena = spawn(TSX, [ARENA, '--a', `cmd:${process.execPath} ${sleeper} ${pidFile}`, '--b', 'passive', '--seeds', '1', '--map', 'tel_marum', '--tick-ms', '2', '--out', out], {
    cwd: join(root, 'tools'),
    env: { ...process.env, LIONS_ARENA_TMPDIR: tmpRoot, INIT_CWD: base },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group: the failure path below kills exactly that group.
    detached: true,
  });
  const stderr: string[] = [];
  arena.stderr?.on('data', (c: Buffer) => { stderr.push(c.toString('utf8')); });
  arena.stdout?.resume();
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
    arena.once('exit', (code, signal) => { res({ code, signal }); });
  });
  cleanups.push(async () => {
    // The failure path (or a sleeper the arena left on purpose): the group we
    // made, by the arena's own pid, which leads it. ESRCH means it is empty.
    // Only while the arena still runs: once it has exited, its pid (and so the
    // group id) may be reused by an unrelated process.
    const pgid = arena.pid;
    if (pgid !== undefined && arena.exitCode === null && arena.signalCode === null) {
      try { process.kill(-pgid, 'SIGKILL'); } catch { /* the group is gone */ }
    }
    if (arena.exitCode === null && arena.signalCode === null) await exit;
  });
  return { arena, tmpRoot, pidFile, stderr, exit };
}

describe('pnpm arena under a signal', () => {
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    it(`${signal}: the players stop, every temp directory and its ticket go, and the arena exits ${code}`, async () => {
      const { arena, tmpRoot, pidFile, stderr, exit } = startArena();
      // The seat's temp directory stands, with its ticket, and the sleeper runs.
      await until('the external player\'s temp directory', () => readdirSync(tmpRoot).some((d) => d.startsWith('lions-arena-')), 60_000);
      const dir = join(tmpRoot, readdirSync(tmpRoot).find((d) => d.startsWith('lions-arena-')) ?? '');
      await until('the ticket', () => existsSync(join(dir, 'ticket')), 10_000);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      await until('the sleeper\'s pid', () => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '', 10_000);
      const sleeperPid = Number(readFileSync(pidFile, 'utf8'));
      expect(alive(sleeperPid)).toBe(true);

      arena.kill(signal);
      const ended = await Promise.race([exit, sleep(30_000).then(() => null)]);
      expect(ended, stderr.join('')).not.toBeNull();
      expect(ended?.code, stderr.join('')).toBe(code);
      expect(readdirSync(tmpRoot)).toEqual([]);
      await until('the sleeper to go', () => !alive(sleeperPid), 5000);
    }, 90_000);
  }

  it('a child deaf to SIGTERM is SIGKILLed: exit 130, nothing left', async () => {
    const { arena, tmpRoot, pidFile, stderr, exit } = startArena({ stubborn: true });
    await until('the external player\'s temp directory', () => readdirSync(tmpRoot).some((d) => d.startsWith('lions-arena-')), 60_000);
    await until('the sleeper\'s pid', () => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '', 10_000);
    const sleeperPid = Number(readFileSync(pidFile, 'utf8'));
    arena.kill('SIGINT');
    const ended = await Promise.race([exit, sleep(30_000).then(() => null)]);
    expect(ended?.code, stderr.join('')).toBe(130);
    expect(readdirSync(tmpRoot)).toEqual([]);
    await until('the sleeper to go', () => !alive(sleeperPid), 5000);
  }, 90_000);

  it('a second SIGINT during the cleanup exits at once, 130, the cleanup unfinished (the escape hatch)', async () => {
    const { arena, tmpRoot, pidFile, stderr, exit } = startArena({ stubborn: true });
    await until('the external player\'s temp directory', () => readdirSync(tmpRoot).some((d) => d.startsWith('lions-arena-')), 60_000);
    await until('the sleeper\'s pid', () => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '', 10_000);
    arena.kill('SIGINT');
    await until('the cleanup to start', () => stderr.join('').includes('arena: SIGINT: stopping'), 10_000);
    // The cleanup is waiting out the stubborn child's SIGKILL escalation (2 s) now.
    await sleep(300);
    expect(arena.exitCode).toBeNull();
    const second = Date.now();
    arena.kill('SIGINT');
    const ended = await Promise.race([exit, sleep(30_000).then(() => null)]);
    // Well inside the 1.7 s of escalation the first cleanup still had to wait.
    expect(Date.now() - second, stderr.join('')).toBeLessThan(800);
    expect(ended?.code, stderr.join('')).toBe(130);
    expect(stderr.join('').split('arena: SIGINT: stopping').length - 1).toBe(1);
    expect(stderr.join('')).toContain('arena: second SIGINT: exiting now, cleanup unfinished');
  }, 90_000);
});
