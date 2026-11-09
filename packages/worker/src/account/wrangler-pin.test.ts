/** Pins on wrangler.jsonc for the accounts bindings (GH-1131 L2, L3). The day ACCOUNTS is bound, /privacy must
 *  reach the Worker and both account limiters must exist. Each check is a pure function over a parsed config, with
 *  constructed configs proving it can fail. Today ACCOUNTS is unbound, so the repo checks pass vacuously. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

interface Cfg {
  assets?: { run_worker_first?: string[] };
  d1_databases?: { binding: string }[];
  ratelimits?: { name: string }[];
}

/** Strip // and block comments outside strings, then parse. */
const strip = (s: string): string => s.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : '')).replace(/,(\s*[}\]])/g, '$1');
const globToRe = (g: string): RegExp => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

const accountsBound = (cfg: Cfg): boolean => (cfg.d1_databases ?? []).some((d) => d.binding === 'ACCOUNTS');

/** Problems with a config: empty means fine. */
export function privacyRoutingProblems(cfg: Cfg): string[] {
  if (!accountsBound(cfg)) return [];
  const globs = cfg.assets?.run_worker_first ?? [];
  return globs.some((g) => globToRe(g).test('/privacy')) ? [] : ['ACCOUNTS is bound but /privacy is not in assets.run_worker_first'];
}

export function limiterProblems(cfg: Cfg): string[] {
  if (!accountsBound(cfg)) return [];
  const names = (cfg.ratelimits ?? []).map((r) => r.name);
  return ['ACCOUNT_LIMIT', 'ACCOUNT_OP_LIMIT'].filter((n) => !names.includes(n)).map((n) => `ACCOUNTS is bound but ratelimit ${n} is missing`);
}

const repo = JSON.parse(strip(readFileSync(ROOT + 'wrangler.jsonc', 'utf8'))) as Cfg;
const bound: Cfg = { d1_databases: [{ binding: 'DB' }, { binding: 'ACCOUNTS' }] };

describe('wrangler.jsonc accounts pins', () => {
  it('the repo config: /privacy reaches the Worker whenever ACCOUNTS is bound (L3)', () => {
    expect(privacyRoutingProblems(repo)).toEqual([]);
  });
  it('the repo config: both account limiters exist whenever ACCOUNTS is bound (L2)', () => {
    expect(limiterProblems(repo)).toEqual([]);
  });

  it('falsification: ACCOUNTS bound without /privacy is reported; with it, passes', () => {
    expect(privacyRoutingProblems({ ...bound, assets: { run_worker_first: ['/api/*', '/stats*'] } })).toHaveLength(1);
    expect(privacyRoutingProblems({ ...bound })).toHaveLength(1);
    expect(privacyRoutingProblems({ ...bound, assets: { run_worker_first: ['/api/*', '/privacy'] } })).toEqual([]);
    expect(privacyRoutingProblems({ d1_databases: [{ binding: 'DB' }] })).toEqual([]);
  });
  it('falsification: ACCOUNTS bound without a limiter is reported; with both, passes', () => {
    expect(limiterProblems({ ...bound, ratelimits: [{ name: 'ACCOUNT_LIMIT' }] })).toEqual(['ACCOUNTS is bound but ratelimit ACCOUNT_OP_LIMIT is missing']);
    expect(limiterProblems({ ...bound, ratelimits: [{ name: 'ACCOUNT_OP_LIMIT' }] })).toEqual(['ACCOUNTS is bound but ratelimit ACCOUNT_LIMIT is missing']);
    expect(limiterProblems({ ...bound })).toHaveLength(2);
    expect(limiterProblems({ ...bound, ratelimits: [{ name: 'ACCOUNT_LIMIT' }, { name: 'ACCOUNT_OP_LIMIT' }] })).toEqual([]);
    expect(limiterProblems({ ratelimits: [] })).toEqual([]);
  });
});
