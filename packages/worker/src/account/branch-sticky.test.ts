/**
 * GH-1384 §4.4, case 8 at the routes, the branch switch FLIPPED OPEN: the campaign PUT and the victory's campaign half keep a member's
 * stored pick over a body from a build that predates branching (which strips `picks` and `legacy`). `branch-sticky-closed.test.ts`
 * holds the switch as shipped; `packages/economy/src/branch-sticky.test.ts` holds the rule itself, per track.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../data/src/branches-open', () => ({ BRANCHES_OPEN: true }));

const { BRANCHES_OPEN } = await import('@lions/data/branches-open');
const { body, member, put, revision, setup, stored, victory } = await import('./branch-sticky-kit');

const view = async (r: Response) => ((await r.json()) as { campaign: { brigade: { picks?: Record<string, Record<string, number>>; legacy?: unknown } } }).campaign.brigade;
const LAVI = (a: { picks?: Record<string, Record<string, number>> }) => a.picks?.['mbt_lavi']?.['firepower'];

describe('the campaign PUT keeps the stored pick', () => {
  it('the flip reached the Worker', () => {
    expect(BRANCHES_OPEN).toBe(true);
  });

  it('a member who chose branch 2: an older build\'s stripped body leaves pick 2 and no marker, in the answer and in the row', async () => {
    const h = setup();
    const cookie = await member(h);
    expect((await put(h, cookie, 0, body({ picks: { mbt_lavi: { firepower: 2 } } }))).status).toBe(200);
    expect(LAVI(await stored(h))).toBe(2);
    const r = await put(h, cookie, 1, body());
    expect(r.status).toBe(200);
    const answer = (await r.json()) as { campaign: { digest: string; brigade: { picks?: Record<string, Record<string, number>>; legacy?: unknown } } };
    const answered = answer.campaign.brigade;
    expect([LAVI(answered), answered.legacy]).toEqual([2, {}]);
    // The answer's digest is the digest of what was WRITTEN (the state read computes it from the row), not of the body as sent.
    const state = (await (await h.call('GET', '/api/account/state', { cookie })).json()) as { campaign: { digest: string } };
    expect(answer.campaign.digest).toBe(state.campaign.digest);
    const row = await stored(h);
    expect([LAVI(row), row.legacy]).toEqual([2, {}]);
    expect(await revision(h)).toBe(2);
  });

  it('a body that CHANGES the pick with no stored marker does not move it', async () => {
    const h = setup();
    const cookie = await member(h);
    await put(h, cookie, 0, body({ picks: { mbt_lavi: { firepower: 2 } } }));
    const r = await put(h, cookie, 1, body({ picks: { mbt_lavi: { firepower: 1 } } }));
    expect(LAVI(await view(r))).toBe(2);
    expect(LAVI(await stored(h))).toBe(2);
  });

  it('a stored LEGACY marker lets a body move the pick (a Switch) and clears the marker', async () => {
    const h = setup();
    const cookie = await member(h);
    // The first write of a pickless tier 3 is an old build's linear buy: pick 1 and a marker.
    await put(h, cookie, 0, body());
    expect([LAVI(await stored(h)), (await stored(h)).legacy]).toEqual([1, { mbt_lavi: { firepower: true } }]);
    await put(h, cookie, 1, body({ picks: { mbt_lavi: { firepower: 2 } } }));
    const row = await stored(h);
    expect([LAVI(row), row.legacy]).toEqual([2, {}]);
  });

  it('the first write of a pickless tier 3 is still migrated to pick 1 with a marker', async () => {
    const h = setup();
    const cookie = await member(h);
    const r = await put(h, cookie, 0, body());
    expect([LAVI(await view(r)), (await stored(h)).legacy]).toEqual([1, { mbt_lavi: { firepower: true } }]);
  });

  it('a row stored BEFORE branching is read settled: a body carrying the migrated view (pick 1 and its marker) keeps the marker', async () => {
    const h = setup();
    const cookie = await member(h);
    // A row a closed build wrote: tier 3, no `picks`, no `legacy`. Read settled it is pick 1 with a marker, which is what a new
    // client shows and sends back; a rule that read the raw row would call that a fresh buy and drop the free Switch.
    await h.db.prepare("INSERT INTO campaign_state (member_id, ledger, brigade, bytes, revision, updated_at) VALUES ('m1', '{}', ?1, 10, 1, 1)")
      .bind(JSON.stringify({ upgrades: { mbt_lavi: { firepower: 3 } } })).run();
    await put(h, cookie, 1, body({ picks: { mbt_lavi: { firepower: 1 } }, legacy: { mbt_lavi: { firepower: true } } }));
    const row = await stored(h);
    expect([LAVI(row), row.legacy]).toEqual([1, { mbt_lavi: { firepower: true } }]);
  });

  it('a stale base is a conflict slot that keeps the body as it came, and the stored row is untouched', async () => {
    const h = setup();
    const cookie = await member(h);
    await put(h, cookie, 0, body({ picks: { mbt_lavi: { firepower: 2 } } }));
    const r = await put(h, cookie, 0, body());
    expect(r.status).toBe(409);
    expect(await revision(h)).toBe(1);
    expect(LAVI(await stored(h))).toBe(2);
  });
});

describe('the victory\'s campaign half keeps it too', () => {
  it('a stripped body riding a victory leaves pick 2 and no marker', async () => {
    const h = setup();
    const cookie = await member(h);
    await put(h, cookie, 0, body({ picks: { mbt_lavi: { firepower: 2 } } }));
    const r = await victory(h, cookie, 1, body());
    expect(r.status).toBe(200);
    const row = await stored(h);
    expect([LAVI(row), row.legacy]).toEqual([2, {}]);
    const answer = (await r.json()) as { campaign: { digest: string; brigade: { picks?: Record<string, Record<string, number>> } } };
    expect(LAVI(answer.campaign.brigade)).toBe(2);
    const state = (await (await h.call('GET', '/api/account/state', { cookie })).json()) as { campaign: { digest: string } };
    expect(answer.campaign.digest).toBe(state.campaign.digest);
  });
});
