/**
 * GH-1384, the member's coin path with the branch switch FLIPPED OPEN (`vi.mock` of the one module that holds it): the spend route
 * and the claim take a `branch` on a BRANCHED tier, and only there. A fresh branch buy is final and writes no legacy marker.
 * `branch-coin-closed.test.ts` holds the switch as shipped to dev's bytes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../data/src/branches-open', () => ({ BRANCHES_OPEN: true }));

const { BRANCHES_OPEN } = await import('@lions/data/branches-open');
const { claim, deviceLavi, free, lavi, member, rows, setup, spend, sum, tier, walletEntitlements } = await import('./branch-coin-kit');

const FP = ['mbt_lavi', 'firepower'] as const;
const lavi3 = (extra: object = {}) => tier(FP[0], FP[1], 3, extra);

describe('POST spend, a branched tier', () => {
  it('the flip reached this Worker\'s read of the switch', () => {
    expect(BRANCHES_OPEN).toBe(true);
  });

  it('buys branch 2: the wallet holds the pick, no legacy marker, and the journal and receipt name the branch', async () => {
    const h = setup();
    const cookie = await member(h);
    await lavi(h, cookie);
    const before = await free(h);
    const r = await spend(h, cookie, lavi3({ branch: 2 }));
    expect(r.status).toBe(200);
    expect(await walletEntitlements(h)).toMatchObject({ upgrades: { mbt_lavi: { firepower: { tier: 3, branch: 2 } } } });
    expect((await walletEntitlements(h)).upgrades.mbt_lavi?.firepower).not.toHaveProperty('legacy');
    const last = (await rows(h)).at(-1);
    expect(last).toMatchObject({ kind: 'tier', detail: { unitId: 'mbt_lavi', track: 'firepower', tier: 3, branch: 2, receipt: { kind: 'tier', tier: 3, branch: 2 } } });
    expect(before - (await free(h))).toBe(-(last?.d ?? 0));
    expect(await sum(h)).toBe(await free(h));
  });

  it('refuses a branched tier with no branch, and charges nothing', async () => {
    const h = setup();
    const cookie = await member(h);
    await lavi(h, cookie);
    const before = [await free(h), (await rows(h)).length];
    const r = await spend(h, cookie, lavi3());
    expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([409, 'refused']);
    expect([await free(h), (await rows(h)).length]).toEqual(before);
  });

  it('refuses a branch on a tier that is not branched, and charges nothing', async () => {
    const h = setup();
    const cookie = await member(h);
    await lavi(h, cookie);
    const before = [await free(h), (await rows(h)).length];
    const r = await spend(h, cookie, tier('mbt_lavi', 'armour', 1, { branch: 1 }));
    expect(r.status).toBe(409);
    expect([await free(h), (await rows(h)).length]).toEqual(before);
  });

  it.each([[0], [3], ['1'], [null], [1.5], [true]])('a branch of %j is a malformed body (400), whatever the tier', async (branch) => {
    const h = setup();
    const cookie = await member(h);
    await lavi(h, cookie);
    expect((await spend(h, cookie, lavi3({ branch }))).status).toBe(400);
    expect((await spend(h, cookie, tier('mbt_lavi', 'armour', 1, { branch }))).status).toBe(400);
  });

  it('the other branch of a held one is refused, the same branch is not a second buy (the tier is held)', async () => {
    const h = setup();
    const cookie = await member(h);
    await lavi(h, cookie);
    expect((await spend(h, cookie, lavi3({ branch: 1 }))).status).toBe(200);
    for (const branch of [1, 2]) expect((await spend(h, cookie, lavi3({ branch }))).status).toBe(409);
    expect((await walletEntitlements(h)).upgrades.mbt_lavi?.firepower).toMatchObject({ tier: 3, branch: 1 });
  });
});

describe('POST claim, a carried branched tier', () => {
  it('carries the device\'s pick as a fresh buy: the wallet takes branch 2 with no marker, and the journal row names it', async () => {
    const h = setup();
    const cookie = await member(h, 0);
    const r = await claim(h, cookie, deviceLavi(2));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { carried: { item: string; tier?: number; branch?: number }[]; notCarried: unknown[] };
    expect(body.notCarried).toEqual([]);
    expect(body.carried.filter((a) => a.item === 'tier').map((a) => [a.tier, a.branch])).toEqual([[1, undefined], [2, undefined], [3, 2]]);
    expect((await walletEntitlements(h)).upgrades.mbt_lavi?.firepower).toMatchObject({ tier: 3, branch: 2 });
    expect((await walletEntitlements(h)).upgrades.mbt_lavi?.firepower).not.toHaveProperty('legacy');
    const tiers = (await rows(h)).filter((x) => x.kind === 'tier').map((x) => x.detail);
    expect(tiers.map((d) => [d.tier, d.branch])).toEqual([[1, undefined], [2, undefined], [3, 2]]);
    expect(await sum(h)).toBe(await free(h));
  });

  it('a device tier 3 from before branching (no pick) is migrated to branch 1 and carried as that fresh buy', async () => {
    const h = setup();
    const cookie = await member(h, 0);
    const r = await claim(h, cookie, deviceLavi());
    expect(r.status).toBe(200);
    expect((await walletEntitlements(h)).upgrades.mbt_lavi?.firepower).toMatchObject({ tier: 3, branch: 1 });
    expect((await walletEntitlements(h)).upgrades.mbt_lavi?.firepower).not.toHaveProperty('legacy');
  });
});
