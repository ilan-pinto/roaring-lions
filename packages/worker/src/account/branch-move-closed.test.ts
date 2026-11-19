/**
 * GH-1384, the member's Switch and Return with the branch switch as shipped (closed): the two routes are not in the table, so a request
 * answers as any unknown route, and nothing is read or written. `branch-move.test.ts` holds the switch open.
 */
import { BRANCHES_OPEN } from '@lions/data/branches-open';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_ROUTES } from './routes';
import { accountHarness, seedWalletMember } from './test-kit';

const T0 = 20_000 * 86_400_000 + 3_600_000;

describe('the switch closed: no branch routes', () => {
  it('the switch is closed, and the route table names no branch route', () => {
    expect(BRANCHES_OPEN).toBe(false);
    expect(ACCOUNT_ROUTES.filter((r) => r.pattern.startsWith('branch'))).toEqual([]);
  });

  it.each(['switch', 'return'])('POST branch/%s is an unknown route (404) for a signed-in member, and writes nothing', async (which) => {
    const h = accountHarness({ now: T0 });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 100 });
    const r = await h.call('POST', `/api/account/branch/${which}`, { cookie, body: { op_id: '00000001-6666-4666-8666-666666666666', unitId: 'mbt_lavi', track: 'firepower' } });
    expect([r.status, await r.json()]).toEqual([404, { error: 'not_found' }]);
    expect(((await h.db.prepare('SELECT COUNT(*) AS n FROM account_op').first<{ n: number }>()) as { n: number }).n).toBe(0);
  });
});
