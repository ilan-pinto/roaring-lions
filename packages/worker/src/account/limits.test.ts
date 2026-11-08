import { describe, expect, it } from 'vitest';
import { newAccountBudget, opBudget, perMinute } from './limits';
import { ipBudgetAddress } from './limits';
import { handleAccount } from './routes';
import { accountHarness } from './test-kit';

const NOW = 1_790_000_000_000;
const req = (ip: string) => new Request('https://x.test/', { headers: { 'cf-connecting-ip': ip } });

describe('account limits', () => {
  it('the sixth account from one ip, and the 501st overall, are refused (A1-7)', async () => {
    const h = accountHarness();
    const env = { ...h.env, TICKET_SECRET: 's' };
    for (let i = 0; i < 5; i++) expect(await newAccountBudget(h.db, env, req('198.51.100.1'), NOW)).toBe(true);
    expect(await newAccountBudget(h.db, env, req('198.51.100.1'), NOW)).toBe(false);

    const h2 = accountHarness();
    const env2 = { ...h2.env, TICKET_SECRET: 's' };
    for (let i = 0; i < 500; i++) expect(await newAccountBudget(h2.db, env2, req(`10.0.${i >> 8}.${i & 255}`), NOW)).toBe(true);
    expect(await newAccountBudget(h2.db, env2, req('10.9.9.9'), NOW)).toBe(false);
  });

  it('no secret skips the per-ip count but not the overall one', async () => {
    const h = accountHarness();
    for (let i = 0; i < 6; i++) expect(await newAccountBudget(h.db, h.env, req('198.51.100.2'), NOW)).toBe(true);
  });

  it('no ip is stored', async () => {
    const h = accountHarness();
    const env = { ...h.env, TICKET_SECRET: 's' };
    await newAccountBudget(h.db, env, req('198.51.100.3'), NOW);
    const rows = h.db.raw.prepare('SELECT key FROM rate_day').all() as { key: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.key === '198.51.100.3')).toBe(false);
  });

  it('opBudget refuses the 401st write of a member', async () => {
    const h = accountHarness();
    for (let i = 0; i < 400; i++) expect(await opBudget(h.db, 'm1', NOW)).toBe(true);
    expect(await opBudget(h.db, 'm1', NOW)).toBe(false);
    expect(await opBudget(h.db, 'm2', NOW)).toBe(true);
  });

  it('opBudget refuses the 20,001st write overall, across members (acct-all)', async () => {
    const h = accountHarness();
    for (let i = 0; i < 20_000; i++) expect(await opBudget(h.db, `m${i}`, NOW)).toBe(true);
    expect(await opBudget(h.db, 'm-next', NOW)).toBe(false);
  });

  it('a missing cf-connecting-ip counts under one shared "unknown" key', async () => {
    const h = accountHarness();
    const env = { ...h.env, TICKET_SECRET: 's' };
    const bare = new Request('https://x.test/');
    for (let i = 0; i < 5; i++) expect(await newAccountBudget(h.db, env, bare, NOW)).toBe(true);
    expect(await newAccountBudget(h.db, env, bare, NOW)).toBe(false);
  });

  it('perMinute: true means limited; no limiter means not limited', async () => {
    const seen: string[] = [];
    const deny = { limit: async (o: { key: string }) => (seen.push(o.key), { success: false }) };
    expect(await perMinute(req('1.2.3.4'), deny)).toBe(true);
    expect(seen).toEqual(['1.2.3.4']);
    expect(await perMinute(new Request('https://x.test/'), { limit: async () => ({ success: true }) })).toBe(false);
    expect(await perMinute(req('1.2.3.4'), undefined)).toBe(false);
  });
});

describe('startBudget (M1)', () => {
  it('50 per ip then refused; another ip is still served', async () => {
    const { startBudget } = await import('./limits');
    const h = accountHarness();
    const env = { ...h.env, TICKET_SECRET: 's' };
    for (let i = 0; i < 50; i++) expect(await startBudget(h.db, env, req('198.51.100.4'), NOW)).toBe(true);
    expect(await startBudget(h.db, env, req('198.51.100.4'), NOW)).toBe(false);
    expect(await startBudget(h.db, env, req('198.51.100.5'), NOW)).toBe(true);
  });
});

describe('the dispatcher fails closed without its limiters (L2)', () => {
  const paths: [string, string][] = [
    ['GET', '/api/account/open'], ['GET', '/api/account/me'], ['POST', '/api/account/steam/start'],
    ['GET', '/api/account/steam/return'], ['POST', '/api/account/gone'],
  ];
  for (const drop of ['ACCOUNT_LIMIT', 'ACCOUNT_OP_LIMIT'] as const) {
    it(`503 on every route family when ${drop} is unbound`, async () => {
      const h = accountHarness();
      const env = { ...h.env };
      delete env[drop];
      for (const [m, p] of paths) {
        const res = await handleAccount(new Request('https://roaring-lions.pint12.workers.dev' + p, { method: m, headers: { 'x-rl-account': '1' } }), env, NOW);
        expect(res.status, `${m} ${p}`).toBe(503);
        expect(await res.json()).toEqual({ error: 'accounts are not configured' });
      }
    });
  }
  it('with both bound the same routes are served', async () => {
    const h = accountHarness();
    expect((await h.call('GET', '/api/account/open')).status).toBe(200);
  });
});

describe('GET open takes the signed-in limiter', () => {
  it('429 when ACCOUNT_OP_LIMIT is exhausted', async () => {
    const h = accountHarness({ denyLimiter: ['ACCOUNT_OP_LIMIT'] });
    expect((await h.call('GET', '/api/account/open')).status).toBe(429);
  });
});

describe('startBudget refusals and ipv6 (M1 gaps)', () => {
  it('over the overall cap, a fresh ip is refused and nothing is written', async () => {
    const { startBudget } = await import('./limits');
    const h = accountHarness();
    const env = { ...h.env, TICKET_SECRET: 's' };
    await h.db.prepare(`INSERT INTO rate_day VALUES ('acct-start-all', '', ?1, 5000)`).bind(Math.floor(NOW / 86_400_000)).run();
    const rows = () => (h.db.raw.prepare('SELECT COUNT(*) AS n FROM rate_day').get() as { n: number }).n;
    const before = rows();
    expect(await startBudget(h.db, env, req('198.51.100.60'), NOW)).toBe(false);
    expect(rows()).toBe(before);
  });

  it('two addresses in one /64 share the per-ip budget; another /64 does not', async () => {
    const { startBudget } = await import('./limits');
    const h = accountHarness();
    const env = { ...h.env, TICKET_SECRET: 's' };
    for (let i = 0; i < 50; i++) expect(await startBudget(h.db, env, req(`2001:db8:1:2::${i + 1}`), NOW)).toBe(true);
    expect(await startBudget(h.db, env, req('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), NOW)).toBe(false);
    expect(await startBudget(h.db, env, req('2001:db8:1:3::1'), NOW)).toBe(true);
  });

  it('ipBudgetAddress: /64 for v6, unchanged for v4', () => {
    expect(ipBudgetAddress('198.51.100.4')).toBe('198.51.100.4');
    expect(ipBudgetAddress('unknown')).toBe('unknown');
    expect(ipBudgetAddress('2001:db8:1:2::1')).toBe(ipBudgetAddress('2001:DB8:1:2:ffff:0:0:9'));
    expect(ipBudgetAddress('2001:db8:1:2::1')).not.toBe(ipBudgetAddress('2001:db8:1:3::1'));
    expect(ipBudgetAddress('::1')).toBe('0000:0000:0000:0000::/64');
    expect(ipBudgetAddress('2001:db8::')).toBe('2001:0db8:0000:0000::/64');
  });
});
