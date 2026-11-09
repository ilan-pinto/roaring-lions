import { describe, expect, it } from 'vitest';
import worker from '../index';
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

/** A route's path with `:id` filled by a sample id, so a request reaches the handler instead of a 404. */
const SAMPLE_ID = 'sample-id';
const pathOf = (pattern: string): string => '/api/account/' + pattern.replace(/:\w+/g, SAMPLE_ID);

describe('the account door', () => {
  it('csrf: an evil origin, a missing origin, or a missing header answers 403 and writes nothing, on every non-GET route (A1-2)', async () => {
    const h = accountHarness();
    const writes = ACCOUNT_ROUTES.filter((r) => r.method !== 'GET');
    // The list is the thing under test: every non-GET route, A2 ones as they land, is walked, and GET state is a route.
    expect(ACCOUNT_ROUTES.map((r) => `${r.method} ${r.pattern}`)).toContain('GET state');
    expect(writes.length).toBeGreaterThanOrEqual(7);
    const before = await rowCount(h);
    for (const r of writes) {
      const where = `${r.method} ${r.pattern}`;
      const path = pathOf(r.pattern);
      expect((await h.call(r.method, path, { origin: 'https://evil.example', body: {} })).status, where).toBe(403);
      expect((await h.call(r.method, path, { origin: null, body: {} })).status, where).toBe(403);
      const bare = new Request('https://roaring-lions.pint12.workers.dev' + path, {
        method: r.method, headers: { origin: 'https://roaring-lions.pint12.workers.dev', 'content-type': 'application/json' }, body: '{}',
      });
      expect((await handleAccount(bare, h.env, Date.now())).status, where).toBe(403);
    }
    expect(await rowCount(h)).toBe(before);
  });

  it('a text/plain body answers 415', async () => {
    const h = accountHarness();
    const res = await h.call('POST', '/api/account/logout', { headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
  });

  it('no CORS anywhere (A1-3)', async () => {
    const h = accountHarness();
    expect(ACCOUNT_ROUTES.map((r) => `${r.method} ${r.pattern}`)).toContain('GET state');
    for (const r of ACCOUNT_ROUTES) {
      const res = await h.call(r.method, pathOf(r.pattern), r.method === 'GET' ? {} : { body: {} });
      for (const name of res.headers.keys()) expect(name.startsWith('access-control-')).toBe(false);
    }
    const opt = await h.call('OPTIONS', '/api/account/open');
    expect(opt.status).toBe(405);
    for (const name of opt.headers.keys()) expect(name.startsWith('access-control-')).toBe(false);
    const nope = await h.call('GET', '/api/account/nope');
    expect(nope.status).toBe(404);
    const forbidden = await h.call('POST', '/api/account/logout', { origin: 'https://evil.example' });
    const unsupported = await h.call('POST', '/api/account/logout', { headers: { 'content-type': 'text/plain' } });
    const unbound = await handleAccount(new Request('https://roaring-lions.pint12.workers.dev/api/account/open'), { DB: h.env.DB, ASSETS: h.env.ASSETS }, 0);
    const viaIndex = await worker.fetch(new Request('https://roaring-lions.pint12.workers.dev/api/account/open', { headers: { 'x-rl-account': '1' } }), h.env);
    const viaIndex403 = await worker.fetch(new Request('https://roaring-lions.pint12.workers.dev/api/account/open'), h.env);
    expect([nope.status, forbidden.status, unsupported.status, unbound.status, viaIndex.status, viaIndex403.status]).toEqual([404, 403, 415, 503, 200, 403]);
    for (const res of [nope, forbidden, unsupported, unbound, viaIndex, viaIndex403]) {
      for (const name of res.headers.keys()) expect(name.startsWith('access-control-')).toBe(false);
    }
    expect(viaIndex.headers.get('x-content-type-options')).not.toBeNull();
  });

  it('steam/return is exempt for GET only, and only that path', async () => {
    const h = accountHarness();
    const url = 'https://roaring-lions.pint12.workers.dev/api/account/steam/return';
    const get = await handleAccount(new Request(url), h.env, Date.now());
    expect(get.status).toBe(303);
    const post = await handleAccount(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://roaring-lions.pint12.workers.dev' }, body: '{}' }), h.env, Date.now());
    expect(post.status).toBe(403);
    const other = await handleAccount(new Request(url.replace('steam/return', 'steam/start')), h.env, Date.now());
    expect(other.status).toBe(403);
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

  it('a GET with the header missing answers 403', async () => {
    const h = accountHarness();
    const res = await handleAccount(new Request('https://roaring-lions.pint12.workers.dev/api/account/open'), h.env, Date.now());
    expect(res.status).toBe(403);
  });

  it('a GET still needs the header', async () => {
    const h = accountHarness();
    const res = await h.call('GET', '/api/account/open', { headers: { 'x-rl-account': '0' } });
    expect(res.status).toBe(403);
  });
});
