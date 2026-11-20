import { describe, expect, it } from 'vitest';
import { accountHarness, seedWalletMember } from './test-kit';

// GH-1385 F4: every route that moves money starts with a session guard (`got instanceof Response`).
// Nothing sent these routes a request without a session, so a dropped guard (a cookie-less request
// reaching `got.session`, a 500 where the answer is 401) left every other test green.

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const OP = '00000001-5555-4555-8555-555555555555';

const ROUTES: readonly { name: string; method: 'GET' | 'PUT' | 'POST'; path: string; body?: unknown }[] = [
  { name: 'state', method: 'GET', path: 'state' },
  { name: 'campaign', method: 'PUT', path: 'campaign', body: { op_id: OP, base: 0, campaign: {} } },
  { name: 'mission/start', method: 'POST', path: 'mission/start', body: { op_id: OP, missionId: 'beit_sahwan_1_recon' } },
  { name: 'victory', method: 'POST', path: 'victory', body: { op_id: OP } },
  { name: 'claim', method: 'POST', path: 'claim', body: { op_id: OP } },
  { name: 'spend', method: 'POST', path: 'spend', body: { op_id: OP, item: 'unit', unitId: 'dozer_d9' } },
  { name: 'coupon', method: 'POST', path: 'coupon', body: { op_id: OP, code: 'X' } },
  { name: 'reset-free', method: 'POST', path: 'reset-free', body: { op_id: OP } },
];

describe('the money routes need a session', () => {
  for (const r of ROUTES) {
    it(`${r.name}: no cookie and a cookie nobody holds both answer 401, and write nothing`, async () => {
      const h = accountHarness({ now: T0 });
      await seedWalletMember(h.db, 'm1', T0, { free: 1000 });
      const free = async () => (await h.db.prepare('SELECT free FROM wallet').first<{ free: number }>())?.free;
      const journal = async () => (await h.db.prepare('SELECT COUNT(*) AS n FROM coin_journal').first<{ n: number }>())?.n;
      const before = [await free(), await journal()];
      const bare = await h.call(r.method, `/api/account/${r.path}`, { body: r.body });
      expect(bare.status).toBe(401);
      const stranger = await h.call(r.method, `/api/account/${r.path}`, { cookie: '__Host-rl_session=nope', body: r.body });
      expect(stranger.status).toBe(401);
      expect([await free(), await journal()]).toEqual(before);
    });
  }

  it('the control: the same member with a real cookie is let in to spend', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 1000 });
    const res = await h.call('POST', '/api/account/spend', { cookie, body: { op_id: OP, item: 'unit', unitId: 'dozer_d9' } });
    expect(res.status).toBe(200);
  });
});
