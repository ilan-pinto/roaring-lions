import { describe, expect, it } from 'vitest';
import { newAccountBudget, opBudget, perMinute } from './limits';
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
