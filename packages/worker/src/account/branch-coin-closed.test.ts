/**
 * GH-1384, the member's coin path with the branch switch as shipped (closed): the spend route and the claim are dev's bytes. A
 * `branch` on a body is an unknown field and is ignored as any was, a branched tier is a plain linear tier, and no journal
 * detail, receipt or entitlement gains a `branch` key. `branch-coin.test.ts` holds the same routes with the switch open.
 */
import { BRANCHES_OPEN } from '@lions/data/branches-open';
import { describe, expect, it } from 'vitest';
import { claim, deviceLavi, free, lavi, member, rows, setup, spend, sum, tier, walletEntitlements } from './branch-coin-kit';

describe('the switch closed: spend and claim are dev\'s', () => {
  it('the switch is closed', () => {
    expect(BRANCHES_OPEN).toBe(false);
  });

  it('a spend body that names a branch buys the linear tier 3: no branch on the wallet, the journal or the receipt', async () => {
    const h = setup();
    const cookie = await member(h);
    await lavi(h, cookie);
    const r = await spend(h, cookie, tier('mbt_lavi', 'firepower', 3, { branch: 2 }));
    expect(r.status).toBe(200);
    expect((await walletEntitlements(h)).upgrades.mbt_lavi?.firepower).toEqual({ tier: 3, paidTiers: 0 });
    const last = (await rows(h)).at(-1);
    expect(last?.detail).toEqual({ unitId: 'mbt_lavi', track: 'firepower', tier: 3, receipt: expect.not.objectContaining({ branch: expect.anything() }) });
    expect(await sum(h)).toBe(await free(h));
  });

  it('a malformed branch is ignored too (dev ignored every unknown field)', async () => {
    const h = setup();
    const cookie = await member(h);
    await lavi(h, cookie);
    expect((await spend(h, cookie, tier('mbt_lavi', 'firepower', 3, { branch: 'x' }))).status).toBe(200);
  });

  it('a claim carrying a device tier 3 (even one that names a branch) carries it as the linear tier, with no branch anywhere', async () => {
    const h = setup();
    const cookie = await member(h, 0);
    const r = await claim(h, cookie, deviceLavi(2));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { carried: object[] };
    expect(body.carried.some((a) => 'branch' in a)).toBe(false);
    expect((await walletEntitlements(h)).upgrades.mbt_lavi?.firepower).toEqual({ tier: 3, paidTiers: 0 });
    expect((await rows(h)).filter((x) => x.kind === 'tier').every((x) => !('branch' in x.detail))).toBe(true);
  });
});
