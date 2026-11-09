import { parseWorld, worldMissionIds } from '@lions/economy';
import { world } from '@lions/data';
import { describe, expect, it } from 'vitest';
import { budgetedOp } from './budget';
import { OpReject } from './op';
import { asRoar, readWallet, walletWrite } from './coin';
import { CAS_TRIES } from './config';
import { ACCOUNT_ROUTES } from './routes';
import { accountHarness, ctxFor, memberTablesInMigration, seedWalletMember } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const op = (n: number): string => `${String(n).padStart(8, '0')}-2222-4222-8222-222222222222`;
const M1 = worldMissionIds(parseWorld(world))[0] ?? '';
type H = ReturnType<typeof accountHarness>;

async function memberRows(h: H): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of memberTablesInMigration()) out[t] = (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n ?? 0;
  return out;
}
const spend = (h: H, n: number) =>
  h.db.prepare("INSERT INTO rate_day (scope, key, day, n) VALUES ('acct-ops', 'm1', ?1, ?2) ON CONFLICT (scope, key, day) DO UPDATE SET n = ?2").bind(Math.floor(T0 / DAY), n).run();
const opsToday = async (h: H): Promise<number> =>
  (await h.db.prepare("SELECT n FROM rate_day WHERE scope = 'acct-ops' AND key = 'm1'").first<{ n: number }>())?.n ?? 0;

describe('budgetedOp', () => {
  it('retry_spends_no_budget', async () => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    await spend(h, 399);
    const patch = (id: string) => h.call('PATCH', '/api/account/profile', { cookie, body: { op_id: id, displayName: 'Alpha' } });
    const a = await patch(op(1));
    expect(a.status).toBe(200);
    expect(await opsToday(h)).toBe(400);
    const b = await patch(op(1));
    expect([b.status, await b.json()]).toEqual([200, await a.clone().json()]);
    expect(await opsToday(h)).toBe(400);
    const before = await memberRows(h);
    expect((await patch(op(2))).status).toBe(429);
    expect(await memberRows(h)).toEqual(before);
  });

  it('the budget is charged once across retries, and an exhausted race answers 409 busy', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    const ctx = ctxFor(h.env, T0);
    const losses = async (lose: number) => {
      let attempts = 0;
      return {
        attempts: () => attempts,
        out: await budgetedOp(ctx, { memberId: 'm1', opId: op(lose + 10), kind: 'test' }, async () => {
          const before = await readWallet(h.db, 'm1');
          // Another writer lands between this read and this batch, `lose` times.
          if (attempts++ < lose) await h.db.prepare("UPDATE wallet SET revision = revision + 1 WHERE member_id = 'm1'").run();
          return { statements: walletWrite(h.db, before, { roar: asRoar(before, []), earnLifetime: before.earnLifetime }, []), status: 200, response: { ok: true } };
        }),
      };
    };
    const landed = await losses(2);
    expect(landed.out).toEqual({ status: 200, body: { ok: true } });
    expect(landed.attempts()).toBe(3);
    expect(await opsToday(h)).toBe(1);
    const busy = await losses(CAS_TRIES);
    expect(busy.out).toEqual({ status: 409, body: { error: 'busy' } });
    expect(busy.attempts()).toBe(CAS_TRIES);
    expect(await opsToday(h)).toBe(2);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM account_op').first()).toEqual({ n: 1 });
  });

  it('a bad op id is a 400 and spends nothing; an OpReject writes nothing', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    const ctx = ctxFor(h.env, T0);
    expect(await budgetedOp(ctx, { memberId: 'm1', opId: 'nope', kind: 'test' }, async () => ({ statements: [], status: 200, response: 1 }))).toEqual({ status: 400, body: { error: 'op_id' } });
    expect(await opsToday(h)).toBe(0);
    const rejected = await budgetedOp(ctx, { memberId: 'm1', opId: op(3), kind: 'test' }, async () => { throw new OpReject(404, { error: 'nope' }); });
    expect(rejected).toEqual({ status: 404, body: { error: 'nope' } });
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM account_op').first()).toEqual({ n: 0 });
  });
});

// A2-25: every write route is budgeted. Each later A2 task adds its own rows here.
interface BudgetRow { key: string; call: (h: H, cookie: string) => Promise<Response> }
const BUDGETED: BudgetRow[] = [
  { key: 'PATCH profile', call: (h, cookie) => h.call('PATCH', '/api/account/profile', { cookie, body: { op_id: op(50), displayName: 'Alpha' } }) },
  { key: 'DELETE identity/:id', call: (h, cookie) => h.call('DELETE', '/api/account/identity/ip', { cookie, body: { op_id: op(51) } }) },
  { key: 'POST mission/start', call: (h, cookie) => h.call('POST', '/api/account/mission/start', { cookie, body: { op_id: op(52), missionId: M1 } }) },
  { key: 'POST victory', call: (h, cookie) => h.call('POST', '/api/account/victory', { cookie, body: { op_id: op(53), missionId: M1, stars: 1, start: null, base: 0, campaign: null } }) },
  { key: 'POST spend', call: (h, cookie) => h.call('POST', '/api/account/spend', { cookie, body: { op_id: op(54), item: 'unit', unitId: 'dozer_d9' } }) },
  { key: 'POST coupon', call: (h, cookie) => h.call('POST', '/api/account/coupon', { cookie, body: { op_id: op(55), code: 'x' } }) },
  { key: 'PUT campaign', call: (h, cookie) => h.call('PUT', '/api/account/campaign', { cookie, body: { op_id: op(57), base: 0, ledger: {}, brigade: {}, tutorialDone: false } }) },
  { key: 'PUT slots/:id', call: (h, cookie) => h.call('PUT', '/api/account/slots/s1', { cookie, body: { op_id: op(58), name: 'A', savedAt: 1, build: 'b', body: { version: 1, id: 's1', name: 'A', savedAt: 1, build: 'b', ledger: {}, account: {} } } }) },
  { key: 'DELETE slots/:id', call: (h, cookie) => h.call('DELETE', '/api/account/slots/s1', { cookie, body: { op_id: op(59) } }) },
  { key: 'POST reset-free', call: (h, cookie) => h.call('POST', '/api/account/reset-free', { cookie, body: { op_id: op(56) } }) },
];
// Not budgeted, by name. `DELETE identity/:id` is NOT here: it is budgeted (plan §0.48), so it is in the table above.
const EXEMPT = new Set(['POST delete', 'POST gone', 'POST logout', 'POST logout-all', 'POST steam/start']);

describe('every write route refuses over budget (A2-25)', () => {
  for (const row of BUDGETED) {
    it(`${row.key}: acct-ops spent answers 429 and writes nothing`, async () => {
      const h = accountHarness({ now: T0 });
      const { cookie } = await seedWalletMember(h.db, 'm1', T0);
      await h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES ('is','m1','steam','76561197960287930',?1)").bind(T0).run();
      await h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES ('ip','m1','passkey','c1',?1)").bind(T0).run();
      await spend(h, 400);
      const before = await memberRows(h);
      expect((await row.call(h, cookie)).status).toBe(429);
      expect(await memberRows(h)).toEqual(before);
    });
  }

  it('every non-GET route is budgeted or named exempt', () => {
    const seen = new Set(BUDGETED.map((r) => r.key));
    const unlisted = ACCOUNT_ROUTES.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.pattern}`).filter((k) => !seen.has(k) && !EXEMPT.has(k));
    expect(unlisted).toEqual([]);
    // Neither list names a route that does not exist (a renamed route cannot hide in it).
    const real = new Set(ACCOUNT_ROUTES.map((r) => `${r.method} ${r.pattern}`));
    expect([...seen, ...EXEMPT].filter((k) => !real.has(k))).toEqual([]);
  });
});
