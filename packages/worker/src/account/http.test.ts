import { describe, expect, it } from 'vitest';
import { accountHarness } from './test-kit';
import { MEMBER_TABLES } from './tables';
import { ACCOUNT_ROUTES, handleAccount } from './routes';

const TABLES = [...MEMBER_TABLES.map((t) => t.table), 'rate_day'];

async function rowCount(h: ReturnType<typeof accountHarness>): Promise<number> {
  let n = 0;
  for (const t of TABLES) {
    const r = await h.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>();
    n += r?.n ?? 0;
  }
  return n;
}

describe('the account door', () => {
  it('csrf: an evil origin, a missing origin, or a missing header answers 403 and writes nothing (A1-2)', async () => {
    const h = accountHarness();
    const before = await rowCount(h);
    expect((await h.call('POST', '/api/account/logout', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await h.call('POST', '/api/account/logout', { origin: null })).status).toBe(403);
    const bare = new Request('https://roaring-lions.pint12.workers.dev/api/account/logout', {
      method: 'POST', headers: { origin: 'https://roaring-lions.pint12.workers.dev', 'content-type': 'application/json' }, body: '{}',
    });
    expect((await handleAccount(bare, h.env, Date.now())).status).toBe(403);
    expect(await rowCount(h)).toBe(before);
  });

  it('a text/plain body answers 415', async () => {
    const h = accountHarness();
    const res = await h.call('POST', '/api/account/logout', { headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
  });

  it('no CORS anywhere (A1-3)', async () => {
    const h = accountHarness();
    expect(ACCOUNT_ROUTES.length).toBeGreaterThan(0);
    for (const r of ACCOUNT_ROUTES) {
      const res = await h.call(r.method, `/api/account/${r.pattern}`, r.method === 'GET' ? {} : { body: {} });
      for (const name of res.headers.keys()) expect(name.startsWith('access-control-')).toBe(false);
    }
    const opt = await h.call('OPTIONS', '/api/account/open');
    expect(opt.status).toBe(405);
    for (const name of opt.headers.keys()) expect(name.startsWith('access-control-')).toBe(false);
    expect((await h.call('GET', '/api/account/nope')).status).toBe(404);
  });

  it('closed means closed: a missing row reads closed (A1-13 first half)', async () => {
    const h = accountHarness();
    expect(await (await h.call('GET', '/api/account/open')).json()).toEqual({ open: false });
    await h.db.prepare(`INSERT INTO flags VALUES ('accounts','open',0)`).run();
    expect(await (await h.call('GET', '/api/account/open')).json()).toEqual({ open: true });
    await h.db.prepare(`UPDATE flags SET value = 'closed' WHERE name = 'accounts'`).run();
    expect(await (await h.call('GET', '/api/account/open')).json()).toEqual({ open: false });
  });

  it('unbound answers 503', async () => {
    const h = accountHarness();
    const res = await handleAccount(new Request('https://roaring-lions.pint12.workers.dev/api/account/open'), { DB: h.env.DB, ASSETS: h.env.ASSETS }, 0);
    expect(res.status).toBe(503);
  });

  it('a GET still needs the header', async () => {
    const h = accountHarness();
    const res = await h.call('GET', '/api/account/open', { headers: { 'x-rl-account': '0' } });
    expect(res.status).toBe(403);
  });
});
