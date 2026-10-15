// The vite config loads under vite's NATIVE config loader (#624) -- and keeps
// loading. `configLoader: 'native'` runs the config and everything it imports
// through Node's own type stripping, which resolves relative imports LITERALLY:
// a value import that reaches a file written with extensionless specifiers
// (`@lions/sim`'s source, `../input/cursor`) dies ERR_MODULE_NOT_FOUND, and so
// does `pnpm dev` and `pnpm build`. #624 fixed the chain as it stood and added
// no check, so S-F's first cut (cursor.ts value-importing support-kinds.ts,
// which value-imports `@lions/sim`) broke both and only CI's last step,
// `pnpm build`, could see it. This runs the loader in a child process, the
// same call vite makes, so the chain is gated by `pnpm test`.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './map_visibility';

const APP = join(ROOT, 'packages/app');

// A child process, not an in-process import: vitest's own module graph would
// resolve the extensionless imports for us and hide exactly the failure.
const SCRIPT = `
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { loadConfigFromFile } = await import(require.resolve('vite'));
const r = await loadConfigFromFile({ command: 'build', mode: 'production' }, undefined, process.cwd(), 'silent', undefined, 'native');
if (!r || !Array.isArray(r.config.plugins) || r.config.plugins.length === 0) {
  throw new Error('the config loaded but carries no plugins');
}
console.log('plugins:' + r.config.plugins.length);
`;

describe('packages/app/vite.config.ts under the native config loader', () => {
  it('loads, with its plugins', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
      cwd: APP,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.stderr.split('\n').find((l) => /Error/.test(l)) ?? '', run.stderr).toBe('');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/^plugins:[1-9]/);
  }, 90_000);
});
