import { describe, expect, it } from 'vitest';
import { reduceCampaigns, storedAnswer, withOp } from './op';
import { accountHarness, seedWalletMember } from './test-kit';

const T0 = 20_000 * 86_400_000;
const OP = '00000001-5555-4555-8555-555555555555';

describe('the op log envelope', () => {
  it('stores {s, b}, replays the status, and reads an A1 row (no s) as 200', async () => {
    const h = accountHarness({ now: T0 });
    await seedWalletMember(h.db, 'm1', T0);
    const out = await withOp(h.db, 'm1', OP, 'k', T0, async () => ({ statements: [], status: 409, response: { error: 'stale' } }));
    expect(out).toEqual({ status: 409, body: { error: 'stale' } });
    expect(await storedAnswer(h.db, 'm1', OP)).toEqual({ status: 409, body: { error: 'stale' } });
    await h.db.prepare("INSERT INTO account_op VALUES ('m1', '00000002-5555-4555-8555-555555555555', 'profile.patch', 1, '{\"displayName\":\"A\"}')").run();
    expect(await storedAnswer(h.db, 'm1', '00000002-5555-4555-8555-555555555555')).toEqual({ status: 200, body: { displayName: 'A' } });
    expect(await storedAnswer(h.db, 'm1', '00000003-5555-4555-8555-555555555555')).toBeNull();
  });

  it('a CampaignView in a stored body is reduced to { revision, digest }, at any depth', () => {
    const view = { ledger: { x: 1 }, brigade: {}, tutorialDone: true, revision: 3, digest: 'abc' };
    expect(reduceCampaigns({ campaign: view, deep: [{ campaign: view }], coins: 4 })).toEqual({
      campaign: { revision: 3, digest: 'abc' },
      deep: [{ campaign: { revision: 3, digest: 'abc' } }],
      coins: 4,
    });
    // A wallet view has a revision but no digest or ledger: it is left whole.
    expect(reduceCampaigns({ wallet: { free: 1, revision: 2 } })).toEqual({ wallet: { free: 1, revision: 2 } });
  });
});
