/**
 * GH-984 N1 review: `pnpm wind:capture` refuses the lead's port 5177 however it arrives -- `--port=5177`
 * or `WIND_CAPTURE_PORT=5177` -- before it claims anything or starts a server. Spawns the real script;
 * the refusal line is the tool's own (`claimPortOrAttach` says something different).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOOLS = join(__dirname, '../..');
const run = (args: string[], env: Record<string, string>) =>
  spawnSync('pnpm', ['exec', 'tsx', 'src/perf/wind-captures.ts', ...args], {
    cwd: TOOLS,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });

describe('wind:capture refuses 5177', () => {
  it('by flag', () => {
    const r = run(['--port=5177'], {});
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('[wind] refusing port 5177');
  }, 90_000);
  it('by WIND_CAPTURE_PORT, with or without --attach', () => {
    for (const args of [[], ['--attach']]) {
      const r = run(args, { WIND_CAPTURE_PORT: '5177' });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('[wind] refusing port 5177');
    }
  }, 90_000);
});
